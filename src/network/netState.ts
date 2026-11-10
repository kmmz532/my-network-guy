// 疎通判定の計算（N136）。段1 配線 → 段2 L2 ドメイン → 段3 IP と直結 → 段4 静的経路 → 段5 転送（ping・http）の順に読む。
// L1（配線）→ L2（スイッチによるL2ドメイン）→ L3（IPアドレスとルーティング）の順に確認する。
// 失敗理由は ID で返し、文言は言語ファイルで表示する。
import { isFabricPort, isL3FabricPort, isRelayPort, isRoutingCategory, isSviPort, isSwitchedRouterCategory, ROUTER_SWITCH_LAN_HOST_PORT, SVI_PORT_BASE } from './category';
import type { EngineData, Endpoint, Failure, FailureReason, FirewallRule, Iface, NetLink, NetNode, Network, PathResult, PortConfig, Route } from './types';
import { CATEGORY } from '../data/categories';
import { can } from './capabilities';
import { macOf } from './mac';

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

class Topology {
  private nodes = new Map<string, NetNode>();
  private linkByEndpoint = new Map<string, { link: NetLink; peer: Endpoint }>();
  // 機器の内部のスイッチ（中継の口）でつながる口。スイッチ付きルーターは代表の LAN 口を必ず含める
  private fabricBy = new Map<string, number[]>();

  constructor(
    net: Network,
    private data: EngineData,
  ) {
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
            if (proto === 'ospf' && i.ospf?.area !== oi.ospf?.area) continue;
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
          // RIP は 16 以上で届かない（rip.unreachable）
          if (proto === 'rip' && metric >= 16) continue;
          for (const oi of o.interfaces) {
            if (!joined(oi)) continue;
            if (own.some((x) => inSubnet(oi.ip, x.ip, x.prefix))) continue;
            routes.push({ dest: networkOf(oi.ip, oi.prefix), prefix: oi.prefix, nextHop: hop, protocol: proto });
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

  private bgpRoutes(out: Map<string, Route[]>): void {
    const routers = [...this.nodes.values()].filter((n) => n.bgp !== undefined && this.isRouter(n.uid));
    const ownerOf = (ip: string) => routers.find((r) => r.interfaces.some((i) => i.ip === ip));
    // セッション（学ぶ側 from・広告する側 to・学ぶ側から見た相手のアドレス）
    const sessions: { from: string; to: string; nextHop: string }[] = [];
    for (const r of routers) {
      for (const nb of r.bgp!.neighbors) {
        if (!this.bgpSessionOk(r, nb.ip, nb.remoteAs)) continue;
        sessions.push({ from: r.uid, to: ownerOf(nb.ip)!.uid, nextHop: nb.ip });
      }
    }
    type Entry = { dest: string; prefix: number; path: number[]; nextHop: string | null };
    const best = new Map<string, Map<string, Entry>>();
    const keyOf = (dest: string, prefix: number) => `${dest}/${prefix}`;
    for (const r of routers) {
      const table = new Map<string, Entry>();
      for (const n of r.bgp!.networks) table.set(keyOf(n.dest, n.prefix), { dest: n.dest, prefix: n.prefix, path: [r.bgp!.asn], nextHop: null });
      best.set(r.uid, table);
    }
    for (let round = 0; round < routers.length + 1; round++) {
      let changed = false;
      for (const s of sessions) {
        const learner = routers.find((r) => r.uid === s.from)!;
        const table = best.get(s.from)!;
        for (const e of best.get(s.to)!.values()) {
          if (e.path.includes(learner.bgp!.asn)) continue;
          const path = [...e.path, learner.bgp!.asn];
          const k = keyOf(e.dest, e.prefix);
          const cur = table.get(k);
          if (cur && (cur.nextHop === null || cur.path.length < path.length || (cur.path.length === path.length && cur.nextHop <= s.nextHop))) continue;
          table.set(k, { dest: e.dest, prefix: e.prefix, path, nextHop: s.nextHop });
          changed = true;
        }
      }
      if (!changed) break;
    }
    for (const r of routers) {
      const learned = [...best.get(r.uid)!.values()].filter((e) => e.nextHop !== null);
      const own = r.interfaces;
      const routes: Route[] = learned
        .filter((e) => !own.some((i) => inSubnet(e.dest, i.ip, i.prefix)))
        .map((e) => ({ dest: e.dest, prefix: e.prefix, nextHop: e.nextHop as string, protocol: 'bgp' as const }));
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
    return node ? this.data.categoryOf(node.device) : '';
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

  // 口が停止しているか（shutdown）
  isShut(uid: string, port: number): boolean {
    return this.portCfg(uid, port)?.shutdown === true;
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
      if (this.isShut(ep.node, ep.port) || !this.carries(ep.node, ep.port, vlan)) continue;
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
        if (!this.isShut(peer.node, peer.port) && this.carries(peer.node, peer.port, peerVlan)) {
          // 配線は、実際にたどったものだけを数える（輪の判定に使う）
          cables.add(link.uid);
          if (!tooLong && linkLength(link.path) > this.data.maxLengthOf(link.cable)) {
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

const fail = (reason: FailureReason, node: string): Failure => ({ reason, node });

// 片道の判定（src → dst）。dstIp は宛先のIPアドレス
// 通信の種類（ping は ICMP、http は指定のポートへの TCP）。ファイアウォールの規則の判定に使う
export type Traffic = { kind: 'ping' } | { kind: 'http'; port: number };

// 経路の管理距離（AD）。static 1・OSPF 110・RIP 120
const adOf = (r: Route): number => (r.protocol === 'ospf' ? 110 : r.protocol === 'rip' ? 120 : r.protocol === 'bgp' ? 20 : 1);

// 規則の送信元・宛先（'any' か「a.b.c.d/nn」）に、IPアドレスが入るか
const matchNet = (spec: string, ip: string): boolean => {
  if (spec === 'any') return true;
  const [network, prefix] = spec.split('/');
  return inSubnet(ip, network, Number(prefix));
};

// プライベートアドレス（10/8・172.16/12・192.168/16）か
const isPrivateIp = (ip: string): boolean => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);

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
const unpluggedReason = (topo: Topology, uid: string): 'link.unplugged' | 'wireless.unassociated' => {
  const device = topo.node(uid)?.device;
  return device !== undefined && can(device, 'wireless') ? 'wireless.unassociated' : 'link.unplugged';
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

const deliver = (topo: Topology, srcUid: string, dstUid: string, traffic: Traffic = { kind: 'ping' }, check = true, srcIp?: string, dstIp?: string): PathResult => {
  const path: string[] = [];
  const src = topo.node(srcUid);
  const dst = topo.node(dstUid);
  const err = (failure: Failure): PathResult => ({ ok: false, path, failure });

  if (!src || !dst) return err(fail('ip.unset', srcUid));

  // 送信元・宛先のアドレスを指定したときは、そのインターフェース（省略は最初の口）
  const srcIface = srcIp === undefined ? src.interfaces[0] : src.interfaces.find((i) => i.ip === srcIp);
  if (!srcIface) return err(fail('ip.unset', src.uid));
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
  if (sameIp.length > 1) return err(fail('ip.duplicate', src.uid));

  const inDomain = (domain: DomainResult, ep: Endpoint) =>
    domain.members.some((m) => m.node === ep.node && m.port === ep.port);

  // 同じサブネット: 同じL2ドメインに宛先があるか
  if (inSubnet(dstIface.ip, srcIface.ip, srcIface.prefix)) {
    if (inDomain(srcDomain, dstEp)) {
      // 宛先のIPアドレスが同じL2ドメイン内で重複していれば、宛先への到達は確定しない
      const dstDuplicates = srcDomain.members.filter((m) => topo.ifaceAt(m.node, m.port)?.ip === dstIface.ip);
      if (dstDuplicates.length > 1) return err(fail('ip.duplicate', dst.uid));
      path.push(dst.uid);
      return { ok: true, path };
    }
    return err(fail('ip.unreachable', src.uid));
  }

  // 異なるサブネット: デフォルトゲートウェイを経由する
  if (!src.gateway) return err(fail('gateway.unset', src.uid));
  const gwMember = srcDomain.members.find((m) => topo.ifaceAt(m.node, m.port)?.ip === src.gateway);
  if (!gwMember) return err(fail('gateway.unreachable', src.uid));

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
      if (cur.bgp && cur.bgp.neighbors.some((nb) => !topo.bgpSessionOk(cur, nb.ip, nb.remoteAs))) return err(fail('bgp.no_session', cur.uid));
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
const backOf = (topo: Topology, dstUid: string, srcUid: string, traffic: Traffic, forward: PathResult): PathResult => {
  const dst = topo.node(dstUid);
  const src = topo.node(srcUid);
  if (!forward.nat) return deliver(topo, dstUid, srcUid, traffic, false);
  // 往路の宛先のアドレス（戻りの送信元）から、NAPT の機器の外の口へ。そこから社内の口を経て、元の送信元へ
  const { router, insideIp, outsideIp } = forward.nat;
  const toRouter = deliver(topo, dstUid, router, traffic, false, undefined, outsideIp);
  if (!toRouter.ok) return toRouter;
  const insideIface = topo.node(router)?.interfaces.find((i) => inSubnet(insideIp, i.ip, i.prefix));
  if (!insideIface || !src || !dst) return { ok: false, path: toRouter.path, failure: fail('route.none', router) };
  return deliver(topo, router, srcUid, traffic, false, insideIface.ip, undefined);
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
// 無線の端末とつながるアクセスポイントの組（端末ごとに最も近い、SSID・パスワードの合う、範囲の中のもの）。画面の点線にも使う（N151・N152）
export const wirelessAssociations = (net: Network, data: EngineData): { ap: NetNode; client: NetNode }[] => {
  const aps = net.nodes.filter((n) => data.categoryOf(n.device) === CATEGORY.accessPoint || data.categoryOf(n.device) === CATEGORY.homeRouter);
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
      if (w?.ssid === undefined || cw?.ssid !== w.ssid || cw.password !== w.password) continue;
      // 無線の MAC フィルター（N153）: 登録のない端末は通さない
      if (w.macs !== undefined && (c.macSerial === undefined || !w.macs.includes(macOf(data.categoryOf(c.device), c.macSerial, 0)))) continue;
      // 壁を通るたびに減衰し、減衰後に届く範囲だけが有効（壁の判定がないときは減衰しない）
      const walls = data.wallAt ? wallsBetween(data.wallAt, ap.x, ap.y, c.x, c.y) : 0;
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

// OSPF の隣接（show ip ospf neighbor に出す）。同じエリアで同じサブネットの、OSPF に参加した相手のルーターの口
export const ospfNeighborsOf = (net: Network, data: EngineData, uid: string): { uid: string; ip: string; port: number; neighborIp: string }[] => {
  const topo = new Topology(net, data);
  const r = topo.node(uid);
  if (!r) return [];
  const out: { uid: string; ip: string; port: number; neighborIp: string }[] = [];
  for (const i of r.interfaces) {
    if (i.ospf === undefined) continue;
    for (const m of topo.domainOf({ node: r.uid, port: i.port }).members) {
      if (m.node === r.uid) continue;
      const other = topo.node(m.node);
      if (!other || !topo.isRouter(other.uid)) continue;
      const oi = other.interfaces.find((x) => x.port === m.port);
      if (!oi || oi.ospf === undefined || oi.ospf.area !== i.ospf.area || !inSubnet(oi.ip, i.ip, i.prefix)) continue;
      out.push({ uid: other.uid, ip: i.ip, port: i.port, neighborIp: oi.ip });
    }
  }
  return out;
};

// 静的 NAT（ポートの転送）: 外からルーターの外の口へのポートの通信を、社内のサーバーへ届ける。往路は外→外の口→社内の口→サーバー、復路は逆に戻す（N145）
const viaStatic = (topo: Topology, srcUid: string, routerUid: string, traffic: Traffic): PathResult | null => {
  const r = topo.node(routerUid);
  if (!r || traffic.kind !== 'http') return null;
  const map = r.statics?.find((s) => s.port === traffic.port);
  if (!map) return null;
  const outside = r.interfaces.find((i) => i.nat === 'outside');
  const inside = r.interfaces.find((i) => i.nat === 'inside' && inSubnet(map.insideIp, i.ip, i.prefix));
  const server = topo.allNodes().find((n) => n.interfaces.some((i) => i.ip === map.insideIp));
  if (!outside || !inside || !server) return { ok: false, path: [], failure: fail('route.none', routerUid) };
  const toRouter = deliver(topo, srcUid, routerUid, traffic, true, undefined, outside.ip);
  if (!toRouter.ok) return toRouter;
  const toServer = deliver(topo, routerUid, server.uid, { kind: 'http', port: map.insidePort }, false, inside.ip, map.insideIp);
  if (!toServer.ok) return { ok: false, path: toRouter.path, failure: toServer.failure };
  if (!server.services.some((s) => s.protocol === 'http' && s.port === map.insidePort)) return { ok: false, path: toRouter.path, failure: fail('service.closed', server.uid) };
  const back = deliver(topo, server.uid, routerUid, traffic, false, map.insideIp, inside.ip);
  if (!back.ok) return { ok: false, path: toRouter.path, failure: { reason: 'return.failed', node: server.uid, cause: back.failure } };
  return { ok: true, path: [...toRouter.path, ...toServer.path.slice(1)] };
};

// Ping（ICMP）の判定。往路と復路の両方が通る必要がある
export const ping = (net: Network, data: EngineData, srcUid: string, dstUid: string): PathResult => {
  const topo = new Topology(withWireless(net, data), data);
  const forward = deliver(topo, srcUid, dstUid, { kind: 'ping' });
  if (!forward.ok) return forward;
  const back = backOf(topo, dstUid, srcUid, { kind: 'ping' }, forward);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure }, nat: forward.nat };
  }
  return forward;
};

// HTTP の判定。往路で宛先に届き、宛先が指定ポートでサービスを待ち受けていて、復路も通ること
export const http = (net: Network, data: EngineData, srcUid: string, dstUid: string, port: number): PathResult => {
  const topo = new Topology(withWireless(net, data), data);
  // 外の口への通信が、静的 NAT で社内のサーバーへ届く場合（N145）
  const nat = viaStatic(topo, srcUid, dstUid, { kind: 'http', port });
  if (nat !== null) return nat;
  const forward = deliver(topo, srcUid, dstUid, { kind: 'http', port });
  if (!forward.ok) return forward;
  const dst = topo.node(dstUid);
  // 外から、NAT のルーターの外の口へ来た通信に、静的 NAT の転送先がない（nat.no_forward・NET.md §6）
  if (dst && dst.napt && dst.interfaces.some((i) => i.nat === 'outside') && !dst.statics?.some((s) => s.port === port)) {
    const srcIp = topo.node(srcUid)?.interfaces[0]?.ip;
    if (srcIp !== undefined && !isPrivateIp(srcIp)) return { ok: false, path: forward.path, failure: fail('nat.no_forward', dstUid) };
  }
  if (!dst || !dst.services.some((s) => s.protocol === 'http' && s.port === port)) {
    return { ok: false, path: forward.path, failure: fail('service.closed', dstUid) };
  }
  const back = backOf(topo, dstUid, srcUid, { kind: 'http', port }, forward);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure }, nat: forward.nat };
  }
  return forward;
};

// サーバーが、各クライアントからの HTTP で見るアドレス（N146）。NAPT で送信元を書き換えた通信は外のアドレス、書き換えなければクライアントのアドレス。届かない通信は含めない
export interface SeenSource {
  client: string;
  seenIp: string;
}
export const seenSourcesOf = (net: Network, data: EngineData, serverUid: string, port: number, clientUids: readonly string[]): SeenSource[] =>
  clientUids.flatMap((client) => {
    const r = http(net, data, client, serverUid, port);
    if (!r.ok) return [];
    const ip = r.nat?.outsideIp ?? net.nodes.find((n) => n.uid === client)?.interfaces[0]?.ip;
    return ip === undefined ? [] : [{ client, seenIp: ip }];
  });

// ネットワーク全体の中で、輪になっているL2ドメインがあれば、その輪の機器（スイッチ）の uid を返す。なければ null（社内のネットワークの障害の表示に使う）
export const loopNodeOf = (net: Network, data: EngineData): string | null => {
  const topo = new Topology(withWireless(net, data), data);
  for (const link of net.links) {
    for (const ep of [link.a, link.b]) {
      const loop = topo.domainOf(ep).loop;
      if (loop) return loop.node;
    }
  }
  return null;
};

// 同じチャネルのアクセスポイントどうしの重なり（電波が届く範囲の2倍以内で、同じチャネル。N152）。チャネルは未設定なら 1
export const channelOverlapsOf = (net: Network, data: EngineData): { a: string; b: string }[] => {
  const aps = net.nodes.filter((n) => data.categoryOf(n.device) === CATEGORY.accessPoint || data.categoryOf(n.device) === CATEGORY.homeRouter);
  const out: { a: string; b: string }[] = [];
  for (let i = 0; i < aps.length; i++) {
    for (let j = i + 1; j < aps.length; j++) {
      const a = aps[i];
      const b = aps[j];
      if ((a.wireless?.channel ?? 1) !== (b.wireless?.channel ?? 1)) continue;
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= WIRELESS_RADIUS * 2) out.push({ a: a.uid, b: b.uid });
    }
  }
  return out;
};

// 機器が動的経路（RIP・OSPF）で覚えた経路（show ip rip database・show ip route に使う）
export const learnedRoutesOf = (
  net: Network,
  data: EngineData,
  uid: string,
  protocol: 'rip' | 'ospf' | 'bgp',
): Route[] => new Topology(net, data).routesOf(uid).filter((r) => r.protocol === protocol);

// スイッチの MAC の表（show mac address-table）: 口ごとに、同じ L2 のドメインにつながった端末の MAC（段2の計算の結果。ping の学習ではない・NET.md §5.10）
export const macTableOf = (net: Network, data: EngineData, uid: string): { port: number; mac: string }[] => {
  const topo = new Topology(net, data);
  const self = topo.node(uid);
  if (!self) return [];
  const out: { port: number; mac: string }[] = [];
  for (const port of [...new Set(net.links.filter((l) => l.a.node === uid || l.b.node === uid).map((l) => (l.a.node === uid ? l.a.port : l.b.port)))].sort((a, b) => a - b)) {
    for (const m of topo.domainOf({ node: uid, port }).members) {
      if (m.node === uid) continue;
      const other = topo.node(m.node);
      if (!other || other.macSerial === undefined || topo.isRouter(other.uid)) continue;
      out.push({ port, mac: macOf(topo.categoryOf(other.uid), other.macSerial, m.port) });
    }
  }
  return out;
};

// 通れば通るが直すべき設定（警告・NET.md §6）: 直結の両端の口の VLAN が違う access（vlan.mismatch）、両端の native が違う trunk（vlan.native_mismatch）
export type VlanWarning = { id: 'vlan.mismatch' | 'vlan.native_mismatch'; a: string; b: string };

export const warningsOf = (net: Network): VlanWarning[] => {
  const cfgOf = (uid: string, port: number): PortConfig | undefined => net.nodes.find((n) => n.uid === uid)?.ports.find((p) => p.port === port);
  const out: VlanWarning[] = [];
  for (const l of net.links) {
    const ca = cfgOf(l.a.node, l.a.port);
    const cb = cfgOf(l.b.node, l.b.port);
    if (!ca || !cb) continue;
    if (ca.mode === 'access' && cb.mode === 'access' && (ca.vlan ?? 1) !== (cb.vlan ?? 1)) out.push({ id: 'vlan.mismatch', a: l.a.node, b: l.b.node });
    if (ca.mode === 'trunk' && cb.mode === 'trunk' && (ca.native ?? 1) !== (cb.native ?? 1)) out.push({ id: 'vlan.native_mismatch', a: l.a.node, b: l.b.node });
  }
  return out;
};
