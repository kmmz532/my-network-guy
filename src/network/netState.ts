import { dhcpOf } from './query/dhcp';
// 疎通判定の計算（N136）。段1 配線 → 段2 L2 ドメイン → 段3 IP と直結 → 段4 静的経路 → 段5 転送（ping・http）の順に読む。
// L1（配線）→ L2（スイッチによるL2ドメイン）→ L3（IPアドレスとルーティング）の順に確認する。
// 失敗理由は ID で返し、文言は言語ファイルで表示する。
import { isFabricPort, isL3FabricPort, isRelayPort, isRoutingCategory, isSviPort, isSwitchedRouterCategory, ROUTER_SWITCH_LAN_HOST_PORT, SVI_PORT_BASE } from './category';
import { analyze } from './engine/analyze';
import type { EngineData, Endpoint, Failure, FailureReason, FirewallRule, Iface, NetLink, NetNode, Network, PathResult, PortConfig, Route } from './types';
import { CATEGORY } from '../data/categories';
import { can } from './capabilities';
import { macOf } from './mac';
import { electVrrpMaster, type VrrpMember } from './vrrp';
import { computeStp, type StpResult } from './stp';
import { assignDhcp, type DhcpResult } from './dhcp';
import { computeLags, type LagResult } from './lag';
import { computeBgp, type BgpEnv, type BgpResult } from './bgp';
import { duplicateRouterIds, ospfMismatch, type OspfMismatch } from './ospf';
import { cableMaxLength, deviceCategory, portSpeed } from '../registry/query';

const MAX_HOPS = 16;

export const ipToInt = (ip: string): number =>
  ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);

const maskOf = (prefix: number): number => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

// IPアドレスのネットワークアドレス（a.b.c.d/nn の a.b.c.d の部分）
const networkOf = (ip: string, prefix: number): string => {
  const n = (ipToInt(ip) & maskOf(prefix)) >>> 0;
  return [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
};

export const inSubnet = (ip: string, network: string, prefix: number): boolean =>
  ((ipToInt(ip) & maskOf(prefix)) >>> 0) === ((ipToInt(network) & maskOf(prefix)) >>> 0);

// 配線の長さ（タイル数）。折れ点ごとの縦横の距離の合計
export const linkLength = (path: [number, number][]): number => {
  let length = 0;
  for (let i = 1; i < path.length; i++) {
    length += Math.abs(path[i][0] - path[i - 1][0]) + Math.abs(path[i][1] - path[i - 1][1]);
  }
  return length;
};

const key = (ep: Endpoint) => `${ep.node}:${ep.port}`;

interface DomainResult {
  members: Endpoint[];
  // 配線が上限長を超えていた場合、その配線の端点
  tooLong?: Endpoint;
  // 配線がループしている場合（同じL2ドメインに、来た道以外の配線で既にたどった口がつながる）、そのループの端点
  loop?: Endpoint;
}

// DHCP の割り当ての結果を、網（同じオブジェクト）ごとに覚える。ping を網の全組に行うとき、解決を1回で済ませる
const dhcpCache = new WeakMap<Network, { dhcp: DhcpResult; net: Network }>();

export class Topology {
  private nodes = new Map<string, NetNode>();
  private linkByEndpoint = new Map<string, { link: NetLink; peer: Endpoint }>();
  // 機器の内部のスイッチ（中継の口）でつながる口。スイッチ付きルーターは代表の LAN 口を必ず含める
  private fabricBy = new Map<string, number[]>();
  // リンクアグリゲーション（段1）: まとまった物理のリンクは1本の論理リンクとして扱う（輪の判定・スパニングツリー）
  private lag: LagResult;
  // 論理リンクごとの、スパニングツリーの代表の配線（止まっていない最初の配線）。まとまっていない配線は含まない
  private stpRep = new Map<string, string>();

  // DHCP の割り当ての結果（自動の口がなければ空）
  dhcp: DhcpResult = { leases: [], failed: [], multiple: [] };

  constructor(
    net: Network,
    data: EngineData,
    resolveDhcp = true,
  ) {
    // 自動（DHCP）の口は、割り当てたアドレスを入れた機器で計算する。割り当ては、アドレスのない状態の配線（L2）から求める
    const cached = resolveDhcp ? dhcpCache.get(net) : undefined;
    if (cached) {
      this.dhcp = cached.dhcp;
      net = cached.net;
    } else if (resolveDhcp && net.nodes.some((n) => n.interfaces.some((i) => i.dhcp === true))) {
      const original = net;
      const base = new Topology(net, data, false);
      this.dhcp = assignDhcp(net.nodes, {
        domainOf: (uid, port) => base.domainOf({ node: uid, port }).members,
        // リレーのルーターが、サーバー側の口（サーバーのアドレスと同じサブネットの口。なければリレーの口）から届くか
        reaches: (routerUid, routerIp, serverUid, serverIp) => {
          const toward = base.node(routerUid)?.interfaces.find((i) => i.ip !== '' && inSubnet(serverIp, i.ip, i.prefix));
          return deliver(base, routerUid, serverUid, { kind: 'ping' }, false, toward?.ip ?? routerIp, serverIp).ok;
        },
      });
      net = {
        ...net,
        nodes: net.nodes.map((n) => {
          const mine = this.dhcp.leases.filter((l) => l.uid === n.uid);
          // 受け取れない口は 169.254.x.y/16（機器の連番から決める）。保存してある前回のアドレスは書き換えない
          const failed = this.dhcp.failed.filter((f) => f.uid === n.uid);
          if (mine.length === 0 && failed.length === 0) return n;
          return {
            ...n,
            interfaces: n.interfaces.map((i) => {
              const l = i.dhcp === true ? mine.find((x) => x.port === i.port) : undefined;
              if (i.dhcp === true && l === undefined && failed.some((f) => f.port === i.port)) return { ...i, ip: `169.254.${((n.macSerial ?? 0) >> 8) & 255}.${((n.macSerial ?? 0) & 255) || 1}`, prefix: 16 };
              return l ? { ...i, ip: l.ip, prefix: l.prefix } : i;
            }),
            // 自動の間は、手で入れたゲートウェイとネームサーバーは使わない（プールの値で置き換える）
            gateway: mine.find((l) => l.gateway)?.gateway ?? null,
            nameServer: mine.find((l) => l.dns)?.dns,
          };
        }),
      };
      dhcpCache.set(original, { dhcp: this.dhcp, net });
    }
    for (const node of net.nodes) this.nodes.set(node.uid, node);
    for (const link of net.links) {
      this.linkByEndpoint.set(key(link.a), { link, peer: link.b });
      this.linkByEndpoint.set(key(link.b), { link, peer: link.a });
    }
    for (const ep of this.linkByEndpoint.keys()) {
      const [node, port] = ep.split(':');
      if (this.isFabric(node, Number(port))) {
        const ports = this.fabricBy.get(node) ?? [];
        ports.push(Number(port));
        this.fabricBy.set(node, ports);
      }
    }
    this.lag = computeLags(net.nodes, net.links, (n) => can(n.device, 'lag'), (n, port) => portSpeed(n.device, port));
    for (const b of this.lag.bundles) {
      const rep = b.links.find((l) => !this.isShut(l.a.node, l.a.port) && !this.isShut(l.b.node, l.b.port)) ?? b.links[0];
      for (const l of b.links) this.stpRep.set(l.uid, rep.uid);
    }
    for (const [uid, ports] of this.fabricBy) {
      if (isSwitchedRouterCategory(this.categoryOf(uid)) && !ports.includes(ROUTER_SWITCH_LAN_HOST_PORT)) ports.push(ROUTER_SWITCH_LAN_HOST_PORT);
      this.fabricBy.set(uid, ports);
    }
  }

  // 段4の動的経路（RIP・OSPF の MVP）。RIP・OSPF に参加したインターフェースどうしが、同じ L2 ドメインでつながる隣接をたどり、
  // 宛先のサブネットへの経路を作る。RIP は跳ね数（16 以上は届かない）、OSPF はコストの合計の最短経路（エリア 0 だけ）。
  // 参加していない機器・インターフェースは、経路を作らない（今までの動きと同じ）
  routesOf(uid: string): Route[] {
    if (this.dyn === undefined) this.dyn = this.dynamicRoutes();
    return this.dyn.get(uid) ?? [];
  }

  private dyn?: Map<string, Route[]>;

  private dynamicRoutes(): Map<string, Route[]> {
    const out = new Map<string, Route[]>();
    const routers = [...this.nodes.values()].filter((n) => this.isRouter(n.uid));
    for (const proto of ['rip', 'ospf'] as const) {
      const joined = (i: Iface): boolean => (proto === 'rip' ? i.rip === true : i.ospf !== undefined);
      // 隣接（同じサブネットで、両方が参加している）。辺は相手の機器と、こちらの口の番号と、相手の口のアドレス
      const adj = new Map<string, { to: string; cost: number; nextHop: string }[]>();
      for (const r of routers) {
        for (const i of r.interfaces) {
          if (!joined(i)) continue;
          for (const m of this.domainOf({ node: r.uid, port: i.port }).members) {
            if (m.node === r.uid) continue;
            const other = this.nodes.get(m.node);
            if (!other || !this.isRouter(other.uid)) continue;
            const oi = other.interfaces.find((x) => x.port === m.port);
            if (!oi || !joined(oi) || !inSubnet(oi.ip, i.ip, i.prefix)) continue;
            // OSPF の隣接は、同じエリアの口どうしだけ（エリアが違えば隣接しない・N142）
            if (proto === 'ospf' && ospfMismatch(i, oi) !== null) continue;
            const cost = proto === 'rip' ? 1 : (i.ospf?.cost ?? 1);
            (adj.get(r.uid) ?? adj.set(r.uid, []).get(r.uid)!).push({ to: other.uid, cost, nextHop: oi.ip });
          }
        }
      }
      for (const r of routers) {
        // 自分のインターフェース（参加している）と同じサブネットは、直結の経路として扱うため、経路を作らない
        const own = r.interfaces.filter(joined);
        // 最短経路（Bellman-Ford。機器は少ない）。最初の一歩の相手のアドレスを覚える
        const dist = new Map<string, number>([[r.uid, 0]]);
        const first = new Map<string, string>();
        for (let round = 0; round < this.nodes.size; round++) {
          let changed = false;
          for (const [from, edges] of adj) {
            const d = dist.get(from);
            if (d === undefined) continue;
            for (const e of edges) {
              const nd = d + e.cost;
              if (dist.get(e.to) === undefined || nd < (dist.get(e.to) as number)) {
                dist.set(e.to, nd);
                first.set(e.to, from === r.uid ? e.nextHop : (first.get(from) as string));
                changed = true;
              }
            }
          }
          if (!changed) break;
        }
        const routes: Route[] = [];
        for (const o of routers) {
          if (o.uid === r.uid || dist.get(o.uid) === undefined) continue;
          const hop = first.get(o.uid);
          if (hop === undefined) continue;
          const metric = dist.get(o.uid) as number;
          // 既定の経路の配布（default-information originate）: 配る機器への最短の道を、0.0.0.0/0 の経路にする
          if (proto === 'ospf' && o.ospf?.defaultOriginate === true) routes.push({ dest: '0.0.0.0', prefix: 0, nextHop: hop, protocol: 'ospf', metric });
          // RIP は 16 以上で届かない（rip.unreachable）
          if (proto === 'rip' && metric >= 16) continue;
          for (const oi of o.interfaces) {
            if (!joined(oi)) continue;
            if (own.some((x) => inSubnet(oi.ip, x.ip, x.prefix))) continue;
            const interArea = proto === 'ospf' && !own.some((x) => x.ospf?.area === oi.ospf?.area);
            routes.push({ dest: networkOf(oi.ip, oi.prefix), prefix: oi.prefix, nextHop: hop, protocol: proto, metric, ...(interArea ? { interArea: true } : {}) });
          }
        }
        out.set(r.uid, [...(out.get(r.uid) ?? []), ...routes]);
      }
    }
    this.bgpRoutes(out);
    return out;
  }

  // eBGP（MVP）。相手の AS と、お互いの設定（neighbor）が合い、直接つながっていれば隣接（セッション）になる。
  // 各機器は自分の network 文の宛先を AS パス [自分の AS] で広告し、受け取った経路は自分の AS を含まないものだけ使う。短い AS パスを選ぶ
  // BGP の隣接が成り立つか（相手のアドレスと AS 番号が合い、相手も自分を相手にし、同じ L2 でつながる・N147）
  bgpSessionOk(r: NetNode, nbIp: string, remoteAs: number): boolean {
    const routers = [...this.nodes.values()].filter((n) => n.bgp !== undefined && this.isRouter(n.uid));
    const peer = routers.find((x) => x.interfaces.some((i) => i.ip === nbIp));
    if (!peer || peer.uid === r.uid || peer.bgp!.asn !== remoteAs) return false;
    const back = peer.bgp!.neighbors.find((x) => x.remoteAs === r.bgp!.asn && r.interfaces.some((i) => i.ip === x.ip));
    if (!back) return false;
    const myIface = r.interfaces.find((i) => inSubnet(nbIp, i.ip, i.prefix));
    return myIface !== undefined && this.domainOf({ node: r.uid, port: myIface.port }).members.some((m) => m.node === peer.uid);
  }

  // BGP の計算結果（セッション・候補の経路）。段4の動的経路（static・RIP・OSPF）が決まった後に求める
  bgpOf(uid: string): BgpResult | undefined {
    this.routesOf(uid);
    return this.bgpResult?.get(uid);
  }

  private bgpResult?: Map<string, BgpResult>;

  private bgpRoutes(out: Map<string, Route[]>): void {
    const routers = [...this.nodes.values()].filter((n) => n.bgp !== undefined && this.isRouter(n.uid));
    const igp = (r: NetNode): Route[] => [...r.routes, ...(out.get(r.uid) ?? [])];
    const covers = (ip: string, route: Route) => inSubnet(ip, route.dest, route.prefix);
    const env: BgpEnv = {
      direct: (r, ip) =>
        r.interfaces.some(
          (i) => inSubnet(ip, i.ip, i.prefix) && this.domainOf({ node: r.uid, port: i.port }).members.some((m) => this.nodes.get(m.node)?.interfaces.some((x) => x.ip === ip)),
        ),
      reaches: (r, ip) => r.interfaces.some((i) => inSubnet(ip, i.ip, i.prefix)) || igp(r).some((route) => covers(ip, route)),
    };
    this.bgpResult = computeBgp(routers, env);
    for (const r of routers) {
      const own = r.interfaces;
      const routes: Route[] = [];
      for (const c of this.bgpResult.get(r.uid)!.candidates) {
        if (!c.best || c.local || c.nextHop === null) continue;
        if (own.some((i) => inSubnet(c.dest, i.ip, i.prefix))) continue;
        // ネクストホップが直結でなければ、それを覆す経路（静的・OSPF・RIP）の次のホップに置き換える
        const direct = own.some((i) => inSubnet(c.nextHop!, i.ip, i.prefix));
        const via = direct ? undefined : igp(r).filter((route) => covers(c.nextHop!, route)).sort((a, b) => b.prefix - a.prefix)[0];
        routes.push({ dest: c.dest, prefix: c.prefix, nextHop: via ? via.nextHop : c.nextHop, protocol: 'bgp', metric: c.path.length, ...(c.ebgp ? {} : { ibgp: true }) });
      }
      out.set(r.uid, [...(out.get(r.uid) ?? []), ...routes]);
    }
  }

  // すべての機器（静的 NAT の宛先を探すときに使う）
  allNodes(): NetNode[] {
    return [...this.nodes.values()];
  }

  node(uid: string): NetNode | undefined {
    return this.nodes.get(uid);
  }

  categoryOf(uid: string): string {
    const node = this.nodes.get(uid);
    return node ? deviceCategory(node.device) : '';
  }

  // 口が機器の内部のスイッチにつながるか（その口から同じL2ドメインへ中継される）
  isFabric(uid: string, port: number): boolean {
    return isFabricPort(this.categoryOf(uid), port) || isL3FabricPort(this.categoryOf(uid), port, this.portCfg(uid, port), this.hasIpOn(uid, port));
  }

  // 口に IP のインターフェースがあるか（L3スイッチの口の扱いに使う）
  hasIpOn(uid: string, port: number): boolean {
    return (this.nodes.get(uid)?.interfaces ?? []).some((i) => i.kind === 'port' && i.port === port);
  }

  // 機器の SVI（VLAN のインターフェース）
  svisOf(uid: string): Iface[] {
    return (this.nodes.get(uid)?.interfaces ?? []).filter((i) => i.kind === 'svi');
  }

  // 口が機器の一員として数えられないか（中継だけの口）
  isRelay(uid: string, port: number): boolean {
    return isRelayPort(this.categoryOf(uid), port) || isL3FabricPort(this.categoryOf(uid), port, this.portCfg(uid, port), this.hasIpOn(uid, port));
  }

  isRouter(uid: string): boolean {
    return isRoutingCategory(this.categoryOf(uid));
  }

  // 端点に配線があるか（L1）
  linkAt(ep: Endpoint): { link: NetLink; peer: Endpoint } | undefined {
    return this.linkByEndpoint.get(key(ep));
  }

  ifaceAt(uid: string, port: number) {
    return this.nodes.get(uid)?.interfaces.find((i) => i.port === port);
  }

  // 口の設定（PortConfig）。設定のない口は、VLAN 1 の access として動く（N137）
  portCfg(uid: string, port: number): PortConfig | undefined {
    return this.nodes.get(uid)?.ports?.find((p) => p.port === port);
  }

  // インターフェースの VRRP のグループ（vrid）の、マスターの機器。同じブロードキャストドメインで同じ VRID を持つ動いているインターフェースの中から選ぶ。
  // 動いているものがなければ null（全員が止まっている）
  vrrpMaster(uid: string, port: number, vrid: number): string | null {
    return electVrrpMaster(this.vrrpMembers(uid, port, vrid));
  }

  // 同じブロードキャストドメインで、同じ VRID のグループを持つインターフェース（自分を含む）
  vrrpMembers(uid: string, port: number, vrid: number): VrrpMember[] {
    const self = this.ifaceAt(uid, port);
    if (!self?.vrrp?.some((g) => g.vrid === vrid)) return [];
    const eps: Endpoint[] = [{ node: uid, port }, ...this.domainOf({ node: uid, port }).members];
    const seen = new Set<string>();
    const members: VrrpMember[] = [];
    for (const ep of eps) {
      if (seen.has(ep.node)) continue;
      const iface = this.ifaceAt(ep.node, ep.port);
      const group = iface?.vrrp?.find((g) => g.vrid === vrid);
      if (!iface || !group) continue;
      seen.add(ep.node);
      const peer = this.linkAt(ep)?.peer;
      const down = (i: Iface) => {
        const linked = this.linkAt({ node: ep.node, port: i.port });
        return this.isShut(ep.node, i.port) || !linked || this.isShut(linked.peer.node, linked.peer.port);
      };
      const owner = this.nodes.get(ep.node)!;
      members.push({
        uid: ep.node,
        realIp: iface.ip,
        group,
        downTracked: (group.track ?? []).filter((t) => owner.interfaces.some((i) => i.id === t.iface && down(i))).map((t) => t.iface),
        up: !this.isShut(ep.node, ep.port) && peer !== undefined,
      });
    }
    return members;
  }

  // この口が、仮想の IP アドレス ip のマスターか
  vrrpOwns(uid: string, port: number, ip: string): boolean {
    const group = this.ifaceAt(uid, port)?.vrrp?.find((g) => g.ip === ip);
    return group !== undefined && this.vrrpMaster(uid, port, group.vrid) === uid;
  }

  // スパニングツリーの結果（stp を持つスイッチの間のリンクで、ブロッキングの口を決める）
  private stpResult?: StpResult;
  stp(): StpResult {
    // まとまった物理のリンクは、代表の1本だけを渡す（論理リンクは1本）
    const links = [...this.linkByEndpoint.values()].map((x) => x.link).filter((l, i, all) => all.indexOf(l) === i && (this.stpRep.get(l.uid) ?? l.uid) === l.uid);
    this.stpResult ??= computeStp([...this.nodes.values()], links, (n) => can(n.device, 'stp'));
    return this.stpResult;
  }

  // スパニングツリーが止めている口（ブロッキング）か
  isStpBlocked(uid: string, port: number): boolean {
    // まとまった口は、代表の口の役割に従う
    const linked = this.linkAt({ node: uid, port });
    const rep = linked ? this.stpRep.get(linked.link.uid) : undefined;
    const repLink = rep === undefined ? undefined : this.lag.bundles.flatMap((b) => b.links).find((l) => l.uid === rep);
    const end = repLink === undefined ? { node: uid, port } : repLink.a.node === uid ? repLink.a : repLink.b;
    return this.stp().roles.get(`${end.node}:${end.port}`) === 'blocking';
  }

  // 口が停止しているか（shutdown）
  isShut(uid: string, port: number): boolean {
    // 電源を切った機器は、すべての口が停止している
    return this.nodes.get(uid)?.powered === false || this.portCfg(uid, port)?.shutdown === true;
  }

  // 口に入るフレームの VLAN（access は設定の VLAN、trunk は untagged の native）
  vlanOf(uid: string, port: number): number {
    // SVI は、その VLAN の中にいる（N138）
    if (isSviPort(port)) return port - SVI_PORT_BASE;
    const cfg = this.portCfg(uid, port);
    if (cfg?.mode === 'trunk') return cfg.native ?? 1;
    return cfg?.vlan ?? 1;
  }

  // 口がその VLAN のフレームを通すか（access は同じ VLAN、trunk は許可された VLAN）
  carries(uid: string, port: number, vlan: number): boolean {
    if (isSviPort(port)) return port - SVI_PORT_BASE === vlan;
    const cfg = this.portCfg(uid, port);
    // 設定のない口（機器の口）は、届いたフレームをそのまま受け取る
    if (cfg === undefined) return !isL3FabricPort(this.categoryOf(uid), port, undefined, this.hasIpOn(uid, port)) || vlan === 1;
    if (cfg.mode === 'trunk') return cfg.allowed === undefined || cfg.allowed.includes(vlan);
    return (cfg.vlan ?? 1) === vlan;
  }

  // 端点と同じL2ドメインに属する機器の端点を集める（N137: VLAN ごとに、口の設定を見て広がる）。スイッチは中継するだけで、結果には含めない。
  domainOf(start: Endpoint): DomainResult {
    const members: Endpoint[] = [];
    const visited = new Set<string>();
    const startVlan = this.vlanOf(start.node, start.port);
    const queue: { ep: Endpoint; vlan: number }[] = [{ ep: start, vlan: startVlan }];
    // 同じL2ドメインの配線の数と機器の数。機器を頂点、配線を辺と見て、辺が頂点以上あれば輪になっている
    const cables = new Set<string>();
    const devices = new Set<string>();
    let relay: Endpoint | undefined;
    let tooLong: Endpoint | undefined;

    while (queue.length) {
      const { ep, vlan } = queue.shift()!;
      const k = `${key(ep)}@${vlan}`;
      if (visited.has(k)) continue;
      visited.add(k);
      // 停止している口と、その VLAN を通さない口は、ドメインに入らない
      if (this.isShut(ep.node, ep.port) || this.isStpBlocked(ep.node, ep.port) || !this.carries(ep.node, ep.port, vlan)) continue;
      devices.add(ep.node);

      // 機器の口（設定なし）は、届いたフレームの VLAN に属する。設定のある access の口は、その VLAN の口だけ数える
      const cfgMember = this.portCfg(ep.node, ep.port);
      // 同じ機器の口は、VLAN が違っても1回だけ数える（ドメインの機器の一覧に重複させない）
      if (!this.isRelay(ep.node, ep.port) && (cfgMember === undefined || this.vlanOf(ep.node, ep.port) === vlan) && !members.some((m) => key(m) === key(ep))) {
        members.push(ep);
      }
      if (this.isFabric(ep.node, ep.port)) relay ??= ep;
      const linked = this.linkAt(ep);
      if (linked) {
        const { link, peer } = linked;
        // 相手が access の口なら、フレームはその口の VLAN になる（機器側の口には VLAN の設定がないため）
        const cfgPeer = this.portCfg(peer.node, peer.port);
        const peerVlan = cfgPeer?.mode === 'access' ? this.vlanOf(peer.node, peer.port) : vlan;
        if (!this.isShut(peer.node, peer.port) && !this.isStpBlocked(peer.node, peer.port) && this.carries(peer.node, peer.port, peerVlan)) {
          // 配線は、実際にたどったものだけを数える（輪の判定に使う）
          cables.add(this.lag.representative.get(link.uid) ?? link.uid);
          if (!tooLong && linkLength(link.path) > cableMaxLength(link.cable)) {
            tooLong = ep;
          }
          queue.push({ ep: peer, vlan: peerVlan });
        }
      }
      // 機器の内部のスイッチに入ったら、同じ VLAN を通す口をすべてたどる。SVI（VLAN のインターフェース）は、同じ VLAN のスイッチの中に入る（N138）
      if (this.isFabric(ep.node, ep.port) || isSviPort(ep.port)) {
        for (const port of this.fabricBy.get(ep.node) ?? []) {
          queue.push({ ep: { node: ep.node, port }, vlan });
        }
        for (const svi of this.svisOf(ep.node)) {
          if (svi.vlan === vlan) queue.push({ ep: { node: ep.node, port: svi.port }, vlan });
        }
      }
    }
    // 輪になっていれば、輪の中のスイッチ（なければ始点）を示す
    const loop = cables.size >= devices.size ? (relay ?? start) : undefined;
    return { members, tooLong, loop };
  }
}

export const fail = (reason: FailureReason, node: string): Failure => ({ reason, node });

// 重複したアドレスのどれかが DHCP で配られたものなら、理由を分けて示す
const duplicateReason = (topo: Topology, members: { node: string; port: number }[]): FailureReason =>
  members.some((m) => topo.ifaceAt(m.node, m.port)?.dhcp) ? 'ip.duplicate.dhcp' : 'ip.duplicate';

// 片道の判定（src → dst）。dstIp は宛先のIPアドレス
// 通信の種類（ping は ICMP、http は指定のポートへの TCP）。ファイアウォールの規則の判定に使う
export type Traffic = { kind: 'ping' } | { kind: 'http'; port: number };

// 経路の管理距離（AD）。static 1・OSPF 110・RIP 120
export const adOf = (r: Route): number => (r.protocol === 'ospf' ? 110 : r.protocol === 'rip' ? 120 : r.protocol === 'bgp' ? (r.ibgp ? 200 : 20) : 1);

// 規則の送信元・宛先（'any' か「a.b.c.d/nn」）に、IPアドレスが入るか
const matchNet = (spec: string, ip: string): boolean => {
  if (spec === 'any') return true;
  const [network, prefix] = spec.split('/');
  return inSubnet(ip, network, Number(prefix));
};

// プライベートアドレス（10/8・172.16/12・192.168/16）か
export const isPrivateIp = (ip: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

// ファイアウォールが、この通信を通すか（規則のどれかに合えば通す。規則がなければ拒否）
const allows = (rules: readonly FirewallRule[] | undefined, srcIp: string, dstIp: string, traffic: Traffic): boolean =>
  (rules ?? []).some(
    (r) =>
      matchNet(r.src, srcIp) &&
      matchNet(r.dst, dstIp) &&
      (r.service === 'any' ||
        (r.service === 'ping' && traffic.kind === 'ping') ||
        (r.service === 'http' && traffic.kind === 'http' && (r.port === undefined || r.port === traffic.port))),
  );

// 通信を1方向に届ける。check が true のときは、通り道のファイアウォールの規則を確かめる（戻りの通信は、往路で許した通信の戻りとして確かめない）
// 口に線がないときの理由。無線の端末は、ケーブルがないのではなく、アクセスポイントにつながっていない（N152）
const unpluggedReason = (topo: Topology, uid: string): 'link.unplugged' | 'wireless.unassociated' | 'wlan.psk_mismatch' | 'wlan.auth_mismatch' => {
  const node = topo.node(uid);
  if (node === undefined || !can(node.device, 'wireless')) return 'link.unplugged';
  // 同じ SSID のアクセスポイントがあるのに、パスワードか暗号化の方式が合わない
  const same = topo.allNodes().filter((n) => n.uid !== uid && n.wireless?.ssid !== undefined && n.wireless.ssid === node.wireless?.ssid && can(n.device, 'wireless') && n.wireless.password !== undefined);
  if (same.some((ap) => (ap.wireless?.security ?? 'wpa2') !== 'open' && ap.wireless?.password !== node.wireless?.password)) return 'wlan.psk_mismatch';
  if (same.some((ap) => ap.wireless?.security === 'wpa3') && !can(node.device, 'wpa3')) return 'wlan.auth_mismatch';
  return 'wireless.unassociated';
};

// ポートセキュリティ（N153）: 機器の口が、登録のない MAC の機器をつないだとき、つないだ先のスイッチの口で止める
// 登録（macs）のない口は制限しない。機器の MAC は、機器の連番と口から求める
const securityDenied = (topo: Topology, device: NetNode, devicePort: number): Failure | null => {
  const link = topo.linkAt({ node: device.uid, port: devicePort });
  if (!link) return null;
  const sw = link.peer;
  const macs = topo.portCfg(sw.node, sw.port)?.macs;
  if (macs === undefined) return null;
  if (device.macSerial === undefined) return fail('port.security', sw.node);
  const mac = macOf(topo.categoryOf(device.uid), device.macSerial, devicePort);
  return macs.includes(mac) ? null : fail('port.security', sw.node);
};

export const deliver = (topo: Topology, srcUid: string, dstUid: string, traffic: Traffic = { kind: 'ping' }, check = true, srcIp?: string, dstIp?: string): PathResult => {
  const path: string[] = [];
  const src = topo.node(srcUid);
  const dst = topo.node(dstUid);
  const err = (failure: Failure): PathResult => ({ ok: false, path, failure });

  if (!src || !dst) return err(fail('ip.unset', srcUid));

  // 送信元・宛先のアドレスを指定したときは、そのインターフェース（省略は最初の口）
  const srcIface = srcIp === undefined ? src.interfaces[0] : src.interfaces.find((i) => i.ip === srcIp);
  if (!srcIface) return err(fail('ip.unset', src.uid));
  // 自動（DHCP）の口がアドレスを受け取れなかった
  if (srcIface.dhcp === true && topo.dhcp.failed.some((f) => f.uid === src.uid && f.port === srcIface.port)) return err(fail(topo.dhcp.failed.find((f) => f.uid === src.uid && f.port === srcIface.port)?.reason ?? 'dhcp.no_offer', src.uid));
  const srcEp: Endpoint = { node: src.uid, port: srcIface.port };
  if (topo.isShut(src.uid, srcIface.port)) return err(fail('port.shutdown', src.uid));
  if (!topo.linkAt(srcEp)) return err(fail(unpluggedReason(topo, src.uid), src.uid));
  const srcSecurity = securityDenied(topo, src, srcIface.port);
  if (srcSecurity) return err(srcSecurity);
  // 相手の口が停止していれば、その口で止まる（port.shutdown）
  const srcPeer = topo.linkAt(srcEp)!.peer;
  if (topo.isShut(srcPeer.node, srcPeer.port)) return err(fail('port.shutdown', srcPeer.node));

  const dstIface = dstIp === undefined ? dst.interfaces[0] : dst.interfaces.find((i) => i.ip === dstIp);
  if (!dstIface) return err(fail('ip.unset', dst.uid));
  const dstEp: Endpoint = { node: dst.uid, port: dstIface.port };
  if (!topo.linkAt(dstEp)) return err(fail(unpluggedReason(topo, dst.uid), dst.uid));
  const dstSecurity = securityDenied(topo, dst, dstIface.port);
  if (dstSecurity) return err(dstSecurity);

  path.push(src.uid);

  const srcDomain = topo.domainOf(srcEp);
  if (srcDomain.tooLong) return err(fail('link.too_long', srcDomain.tooLong.node));
  if (srcDomain.loop) return err(fail('link.loop', srcDomain.loop.node));
  const sameIp = srcDomain.members.filter((m) => topo.ifaceAt(m.node, m.port)?.ip === srcIface.ip);
  if (sameIp.length > 1) return err(fail(duplicateReason(topo, sameIp), src.uid));

  const inDomain = (domain: DomainResult, ep: Endpoint) =>
    domain.members.some((m) => m.node === ep.node && m.port === ep.port);

  // 同じサブネット: 同じL2ドメインに宛先があるか
  if (inSubnet(dstIface.ip, srcIface.ip, srcIface.prefix)) {
    if (inDomain(srcDomain, dstEp)) {
      // 宛先のIPアドレスが同じL2ドメイン内で重複していれば、宛先への到達は確定しない
      const dstDuplicates = srcDomain.members.filter((m) => topo.ifaceAt(m.node, m.port)?.ip === dstIface.ip);
      if (dstDuplicates.length > 1) return err(fail(duplicateReason(topo, dstDuplicates), dst.uid));
      path.push(dst.uid);
      return { ok: true, path };
    }
    return err(fail('ip.unreachable', src.uid));
  }

  // 異なるサブネット: デフォルトゲートウェイを経由する
  if (!src.gateway) return err(fail('gateway.unset', src.uid));
  const gwMember = srcDomain.members.find((m) => topo.ifaceAt(m.node, m.port)?.ip === src.gateway || topo.vrrpOwns(m.node, m.port, src.gateway as string));
  if (!gwMember) {
    // 仮想の IP アドレスの持ち主（マスター）がいない: 同じ VRID の全員が止まっている
    if (topo.allNodes().some((n) => n.interfaces.some((i) => i.vrrp?.some((g) => g.ip === src.gateway)))) return err(fail('vrrp.no_master', src.uid));
    return err(fail('gateway.unreachable', src.uid));
  }

  let current: Endpoint = gwMember;
  // 今の送信元のアドレス（NAPT で変わる）と、変換の記録
  let curSrcIp = srcIface.ip;
  let natHit: PathResult['nat'];
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const cur = topo.node(current.node);
    if (!cur) return err(fail('route.none', current.node));

    if (cur.uid === dst.uid) {
      path.push(cur.uid);
      return { ok: true, path, nat: natHit };
    }
    if (!topo.isRouter(cur.uid)) return err(fail('route.none', cur.uid));
    path.push(cur.uid);
    // ファイアウォールは、規則に合う通信だけを通す（既定は拒否）
    if (check && topo.categoryOf(cur.uid) === CATEGORY.firewall && !allows(cur.rules, srcIface.ip, dstIface.ip, traffic)) {
      return err(fail('firewall.denied', cur.uid));
    }

    // 家庭用ルーターは、外から始まる通信を既定で止める（社内へ向かう往路を外の口から受けたら拒否。静的 NAT の転送は別の経路で届く・NET.md §4）
    const arrivedFrom = cur.interfaces.find((i) => i.port === current.port);
    if (check && topo.categoryOf(cur.uid) === CATEGORY.homeRouter && arrivedFrom?.nat === 'outside') {
      return err(fail('firewall.denied', cur.uid));
    }
    // 直結しているサブネットに宛先があるか
    const connected = cur.interfaces.find((i) => inSubnet(dstIface.ip, i.ip, i.prefix));
    if (connected) {
      // 直結の外の口へ出るときも、NAPT で送信元を外の口のアドレスに変える（N145）
      const inIf = cur.interfaces.find((i) => i.port === current.port);
      if (cur.napt && inIf?.nat === 'inside' && connected.nat === 'outside' && natHit === undefined) {
        natHit = { router: cur.uid, insideIp: curSrcIp, outsideIp: connected.ip };
        curSrcIp = connected.ip;
      }
      // 社内のアドレス（プライベート）のまま外の口へ出たら、回線の先で届かない（nat.private_source・NET.md §6）。戻りは確かめない
      if (check && connected.nat === 'outside' && natHit === undefined && isPrivateIp(curSrcIp)) return err(fail('nat.private_source', cur.uid));
      const domain = topo.domainOf({ node: cur.uid, port: connected.port });
      if (domain.tooLong) return err(fail('link.too_long', domain.tooLong.node));
      if (domain.loop) return err(fail('link.loop', domain.loop.node));
      if (inDomain(domain, dstEp)) {
        path.push(dst.uid);
        return { ok: true, path, nat: natHit };
      }
      return err(fail('ip.unreachable', cur.uid));
    }

    // 最長一致で静的ルートを選ぶ
    // 設定した経路（static）と、RIP・OSPF の経路を合わせ、最長一致で選ぶ。同じ長さなら管理距離（AD）の小さい方（static 1・OSPF 110・RIP 120）
    const matches = [...cur.routes, ...topo.routesOf(cur.uid)].filter((r) => inSubnet(dstIface.ip, r.dest, r.prefix));
    if (matches.length === 0) {
      // BGP の相手と隣接しない（アドレスか AS 番号が合わない）ときは bgp.no_session（N147）
      const bgp = cur.bgp ? topo.bgpOf(cur.uid) : undefined;
      // 経路は学んだが、ネクストホップに届かない（iBGP の next-hop-self がない）ときは bgp.nexthop_unreachable
      if (bgp?.candidates.some((c) => !c.valid && inSubnet(dstIface.ip, c.dest, c.prefix))) return err(fail('bgp.nexthop_unreachable', cur.uid));
      if (bgp?.sessions.some((x) => x.status.state !== 'established')) return err(fail('bgp.no_session', cur.uid));
      // RIP に参加している機器で経路がないのは、16 ホップ以上で届かない（rip.unreachable・NET.md §6）
      if (cur.interfaces.some((i) => i.rip === true)) return err(fail('rip.unreachable', cur.uid));
      // OSPF のエリア 0 に接していないエリアだけに参加している機器は、経路がエリア 0 へ届かない（ospf.area_detached・NET.md §6）
      const ospfAreas = cur.interfaces.filter((i) => i.ospf !== undefined).map((i) => i.ospf!.area);
      if (ospfAreas.length > 0 && !ospfAreas.includes(0)) return err(fail('ospf.area_detached', cur.uid));
      return err(fail(ospfAreas.length > 0 ? 'ospf.no_neighbor' : 'route.none', cur.uid));
    }
    const route = matches.reduce((best, r) => (r.prefix > best.prefix || (r.prefix === best.prefix && adOf(r) < adOf(best)) ? r : best));

    const egress = cur.interfaces.find((i) => inSubnet(route.nextHop, i.ip, i.prefix));
    if (!egress) return err(fail('route.none', cur.uid));
    // NAPT: 社内の口（inside）から外の口（outside）へ出る通信の送信元を、外の口のアドレスに変える（N145）
    const ingress = cur.interfaces.find((i) => i.port === current.port);
    if (cur.napt && ingress?.nat === 'inside' && egress.nat === 'outside' && natHit === undefined) {
      natHit = { router: cur.uid, insideIp: curSrcIp, outsideIp: egress.ip };
      curSrcIp = egress.ip;
    }
    const egressDomain = topo.domainOf({ node: cur.uid, port: egress.port });
    if (egressDomain.tooLong) return err(fail('link.too_long', egressDomain.tooLong.node));
    if (egressDomain.loop) return err(fail('link.loop', egressDomain.loop.node));
    const next = egressDomain.members.find((m) => topo.ifaceAt(m.node, m.port)?.ip === route.nextHop);
    if (!next) return err(fail('route.none', cur.uid));
    current = next;
  }
  return err(fail('route.loop', current.node));
};

// 戻りの通信。往路で NAPT を行ったときは、外から変換後のアドレス（外の口）へ届き、NAPT の機器が社内のアドレスへ戻す（N145）
export const backOf = (topo: Topology, dstUid: string, srcUid: string, traffic: Traffic, forward: PathResult): PathResult => {
  const dst = topo.node(dstUid);
  const src = topo.node(srcUid);
  if (!forward.nat) return deliver(topo, dstUid, srcUid, traffic, false);
  // 往路の宛先のアドレス（戻りの送信元）から、NAPT の機器の外の口へ。そこから社内の口を経て、元の送信元へ
  const { router, insideIp, outsideIp } = forward.nat;
  const toRouter = deliver(topo, dstUid, router, traffic, false, undefined, outsideIp);
  if (!toRouter.ok) return toRouter;
  const insideIface = topo.node(router)?.interfaces.find((i) => inSubnet(insideIp, i.ip, i.prefix));
  if (!insideIface || !src || !dst) return { ok: false, path: toRouter.path, failure: fail('route.none', router) };
  const rest = deliver(topo, router, srcUid, traffic, false, insideIface.ip, undefined);
  return rest.ok ? { ...rest, path: [...toRouter.path, ...rest.path.slice(1)] } : rest;
};

// 電波の範囲（マス。仮の値・WIRELESS.md §3 の減衰は後続）。範囲の中の無線の端末は、最も近いアクセスポイントの LAN に入る（N151）
export const WIRELESS_RADIUS = 6;
// 壁1マスを通るごとに、電波の届く距離から失われるマス数（仮の値・WIRELESS.md §3）
export const WALL_LOSS = 2;

// アクセスポイントから端末までの経路（x を先、次に y）にある壁のマスの数（両端は数えない）
export const wallsBetween = (wallAt: (x: number, y: number) => boolean, ax: number, ay: number, cx: number, cy: number): number => {
  let count = 0;
  let x = ax;
  let y = ay;
  const toward = (v: number, target: number) => (v < target ? v + 1 : v - 1);
  while (x !== cx) {
    x = toward(x, cx);
    if (!(x === cx && y === cy) && wallAt(x, y)) count++;
  }
  while (y !== cy) {
    y = toward(y, cy);
    if (!(x === cx && y === cy) && wallAt(x, y)) count++;
  }
  return count;
};

// 無線の端末を、最も近いアクセスポイントへ仮想の配線でつなぐ（段1の仮想の配線）。
// 端末の口0 に配線がなく、無線の能力を持ち、範囲の中にアクセスポイントがあるとき。アクセスポイントの口は 100 番から、端末ごとに1つ使う
// 無線の端末は、SSID とパスワードが合い、範囲の中にあるアクセスポイントの中で最も近いものにつながる（N151）。
// アクセスポイントの無線の VLAN は、つながった端末の口を、その VLAN の access の口として扱う
// アクセスポイント（と無線つきの家庭用ルーター）
export const accessPointsOf = (net: Network, _data: EngineData): NetNode[] =>
  net.nodes.filter((n) => deviceCategory(n.device) === CATEGORY.accessPoint || deviceCategory(n.device) === CATEGORY.homeRouter);

// 無線の端末とつながるアクセスポイントの組（端末ごとに最も近い、SSID・パスワードの合う、範囲の中のもの）。画面の点線にも使う（N151・N152）
export const wirelessAssociations = (net: Network, data: EngineData): { ap: NetNode; client: NetNode }[] => {
  const aps = net.nodes.filter((n) => deviceCategory(n.device) === CATEGORY.accessPoint || deviceCategory(n.device) === CATEGORY.homeRouter);
  if (aps.length === 0) return [];
  const wired = new Set(net.links.flatMap((l) => [`${l.a.node}:${l.a.port}`, `${l.b.node}:${l.b.port}`]));
  const out: { ap: NetNode; client: NetNode }[] = [];
  for (const c of net.nodes) {
    // アクセスポイント（と無線つきの家庭用ルーター）は端末ではない。端末は無線の能力を持つ機器のうち、ほかの接続の口0がないもの
    if (!can(c.device, 'wireless') || wired.has(`${c.uid}:0`)) continue;
    if (aps.includes(c)) continue;
    let best: { ap: NetNode; d: number } | undefined;
    for (const ap of aps) {
      const d = Math.abs(ap.x - c.x) + Math.abs(ap.y - c.y);
      // SSID とパスワードが合うこと（どちらかがなければ、つながらない）
      const w = ap.wireless;
      const cw = c.wireless;
      const security = w?.security ?? 'wpa2';
      // パスワードは、暗号化のない SSID では要らない。WPA3 だけの SSID は、WPA3 に対応する端末だけがつながる
      if (w?.ssid === undefined || cw?.ssid !== w.ssid || (security !== 'open' && cw.password !== w.password)) continue;
      if (security === 'wpa3' && !can(c.device, 'wpa3')) continue;
      // 無線の MAC フィルター（N153）: 登録のない端末は通さない
      if (w.macs !== undefined && (c.macSerial === undefined || !w.macs.includes(macOf(deviceCategory(c.device), c.macSerial, 0)))) continue;
      // 壁を通るたびに減衰し、減衰後に届く範囲だけが有効（壁の判定がないときは減衰しない）
      const walls = wallsBetween(data.wallAt, ap.x, ap.y, c.x, c.y);
      if (d + walls * WALL_LOSS <= WIRELESS_RADIUS && (best === undefined || d < best.d || (d === best.d && ap.uid < best.ap.uid))) best = { ap, d };
    }
    if (best) out.push({ ap: best.ap, client: c });
  }
  return out;
};

// 無線の端末を、つながるアクセスポイントへ仮想の配線でつなぐ（段1の仮想の配線）。アクセスポイントの口は 100 番から、端末ごとに1つ使う
export const withWireless = (net: Network, data: EngineData): Network => {
  const pairs = wirelessAssociations(net, data);
  if (pairs.length === 0) return net;
  const extra: NetLink[] = [];
  const nextPort = new Map<string, number>();
  const apPorts = new Map<string, PortConfig[]>();
  for (const { ap, client: c } of pairs) {
    const port = 100 + (nextPort.get(ap.uid) ?? 0);
    nextPort.set(ap.uid, port - 100 + 1);
    apPorts.set(ap.uid, [...(apPorts.get(ap.uid) ?? []), { port, mode: 'access', vlan: ap.wireless?.vlan ?? 1 }]);
    extra.push({ uid: `__wifi_${c.uid}`, cable: 'utp_cat5e', a: { node: ap.uid, port }, b: { node: c.uid, port: 0 }, path: [[ap.x, ap.y], [c.x, c.y]], paid: 0 });
  }
  // アクセスポイントの口（つないだ端末の口）に、無線の VLAN を付ける
  const nodes = net.nodes.map((n) => (apPorts.has(n.uid) ? { ...n, ports: [...n.ports, ...apPorts.get(n.uid)!] } : n));
  return { ...net, nodes, links: [...net.links, ...extra] };
};

// OSPF の隣接の候補（同じサブネットで OSPF に参加した相手のルーターの口）。条件が合わなければ mismatch に理由を持つ
export interface OspfPeer {
  uid: string;
  ip: string;
  port: number;
  neighborIp: string;
  mismatch: OspfMismatch | null;
}

export const ospfPeersOf = (topo: Topology, uid: string): OspfPeer[] => {
  const r = topo.node(uid);
  if (!r) return [];
  const out: OspfPeer[] = [];
  for (const i of r.interfaces) {
    if (i.ospf === undefined) continue;
    for (const m of topo.domainOf({ node: r.uid, port: i.port }).members) {
      if (m.node === r.uid) continue;
      const other = topo.node(m.node);
      if (!other || !topo.isRouter(other.uid)) continue;
      const oi = other.interfaces.find((x) => x.port === m.port);
      if (!oi || oi.ospf === undefined || !inSubnet(oi.ip, i.ip, i.prefix)) continue;
      out.push({ uid: other.uid, ip: i.ip, port: i.port, neighborIp: oi.ip, mismatch: ospfMismatch(i, oi) });
    }
  }
  return out;
};

// 同じチャネルのアクセスポイントどうしの重なり（電波が届く範囲の2倍以内で、同じチャネル。N152）。チャネルは未設定なら 1


// 通れば通るが直すべき設定（警告・NET.md §6）: 直結の両端の口の VLAN が違う access（vlan.mismatch）、両端の native が違う trunk（vlan.native_mismatch）
export type VlanWarning = { id: 'wlan.open' | 'wlan.weak_cipher' | 'wlan.transition' | 'dhcp.multiple_servers' | 'lag.mismatch' | 'vlan.mismatch' | 'vlan.native_mismatch' | 'ospf.duplicate_router_id' | 'vrrp.gateway_real_ip' | 'vrrp.vip_mismatch'; a: string; b: string };

export const warningsOf = (net: Network, data?: EngineData): VlanWarning[] => {
  const cfgOf = (uid: string, port: number): PortConfig | undefined => net.nodes.find((n) => n.uid === uid)?.ports.find((p) => p.port === port);
  const out: VlanWarning[] = [];
  for (const l of net.links) {
    const ca = cfgOf(l.a.node, l.a.port);
    const cb = cfgOf(l.b.node, l.b.port);
    if (!ca || !cb) continue;
    if (ca.mode === 'access' && cb.mode === 'access' && (ca.vlan ?? 1) !== (cb.vlan ?? 1)) out.push({ id: 'vlan.mismatch', a: l.a.node, b: l.b.node });
    if (ca.mode === 'trunk' && cb.mode === 'trunk' && (ca.native ?? 1) !== (cb.native ?? 1)) out.push({ id: 'vlan.native_mismatch', a: l.a.node, b: l.b.node });
  }
  // 無線: 暗号化のない SSID・弱い暗号（WEP・WPA）・WPA2/WPA3 の移行モード（アクセスポイントごとに1件）
  if (data) {
    for (const ap of accessPointsOf(net, data)) {
      if (ap.wireless?.ssid === undefined) continue;
      const s = ap.wireless.security ?? 'wpa2';
      const id = s === 'open' ? 'wlan.open' : s === 'wep' || s === 'wpa' ? 'wlan.weak_cipher' : s === 'wpa2wpa3' ? 'wlan.transition' : null;
      if (id) out.push({ id, a: ap.uid, b: ap.uid });
    }
  }
  // DHCP: 同じドメインに DHCP サーバーが2台以上ある（サーバーの組ごとに1件）
  if (data) {
    const pairs = new Set<string>();
    for (const m of dhcpOf(analyze(net, data)).multiple) {
      const key = [...m.servers].sort().join('|');
      if (pairs.has(key)) continue;
      pairs.add(key);
      out.push({ id: 'dhcp.multiple_servers', a: m.servers[0], b: m.servers[1] });
    }
  }
  // リンクアグリゲーション: まとまらない口がある2台（組ごとに1件）
  const lag = computeLags(net.nodes, net.links, (n) => can(n.device, 'lag'), (n, port) => portSpeed(n.device, port));
  const lagPairs = new Set<string>();
  for (const l of net.links) {
    if (!lag.mismatched.has(l.uid)) continue;
    const pair = [l.a.node, l.b.node].sort().join('|');
    if (lagPairs.has(pair)) continue;
    lagPairs.add(pair);
    out.push({ id: 'lag.mismatch', a: l.a.node, b: l.b.node });
  }
  // VRRP: 同じネットワーク・同じ VRID で仮想の IP アドレスが違う（組ごとに1件）と、端末のゲートウェイが仮想ではなく実の IP アドレス
  const groups = net.nodes.flatMap((n) => n.interfaces.flatMap((i) => (i.vrrp ?? []).map((g) => ({ uid: n.uid, iface: i, g }))));
  for (let x = 0; x < groups.length; x++) {
    for (let y = x + 1; y < groups.length; y++) {
      const a = groups[x];
      const b = groups[y];
      if (a.uid !== b.uid && a.g.vrid === b.g.vrid && a.g.ip !== b.g.ip && inSubnet(a.iface.ip, b.iface.ip, b.iface.prefix)) out.push({ id: 'vrrp.vip_mismatch', a: a.uid, b: b.uid });
    }
  }
  for (const n of net.nodes) {
    if (!n.gateway || n.interfaces.some((i) => i.vrrp !== undefined)) continue;
    const owner = groups.find((x) => x.iface.ip === n.gateway);
    if (owner) out.push({ id: 'vrrp.gateway_real_ip', a: n.uid, b: owner.uid });
  }
  // 同じルーター ID の OSPF のルーター（組ごとに1件）
  for (const uids of duplicateRouterIds(net.nodes)) out.push({ id: 'ospf.duplicate_router_id', a: uids[0], b: uids[1] });
  return out;
};

// 受け取れた自動の口の ip・prefix を機器へ書き戻す（前回のアドレスとして保存する。NET.md §5.7）。変わる機器がなければ同じ配列を返す
export const dhcpWriteBack = <T extends { uid: string; interfaces: Iface[] }>(nodes: readonly T[], links: readonly NetLink[], segments: Network['segments'], data: EngineData): readonly T[] => {
  if (!nodes.some((n) => n.interfaces.some((i) => i.dhcp === true))) return nodes;
  const leases = analyze({ nodes: nodes as unknown as NetNode[], links: [...links], segments }, data).dhcp.leases;
  let changed = false;
  const next = nodes.map((n) => {
    const interfaces = n.interfaces.map((i) => {
      const l = i.dhcp === true ? leases.find((x) => x.uid === n.uid && x.port === i.port) : undefined;
      if (!l || (l.ip === i.ip && l.prefix === i.prefix)) return i;
      changed = true;
      return { ...i, ip: l.ip, prefix: l.prefix };
    });
    return interfaces.some((i, k) => i !== n.interfaces[k]) ? { ...n, interfaces } : n;
  });
  return changed ? next : nodes;
};


// BGP の計算結果（show ip bgp・show ip bgp summary に出す）。BGP を動かしていない機器は undefined
