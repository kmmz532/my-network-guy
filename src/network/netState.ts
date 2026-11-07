// 疎通判定の計算（N136）。段1 配線 → 段2 L2 ドメイン → 段3 IP と直結 → 段4 静的経路 → 段5 転送（ping・http）の順に読む。
// L1（配線）→ L2（スイッチによるL2ドメイン）→ L3（IPアドレスとルーティング）の順に確認する。
// 失敗理由は ID で返し、文言は言語ファイルで表示する。
import { isFabricPort, isRelayPort, isRoutingCategory, ROUTER_SWITCH_LAN_HOST_PORT } from './category';
import type { EngineData, Endpoint, Failure, FailureReason, FirewallRule, Iface, NetLink, NetNode, Network, PathResult, PortConfig, Route } from './types';
import { CATEGORY } from '../data/categories';

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
      if (this.categoryOf(uid) === CATEGORY.routerSwitch && !ports.includes(ROUTER_SWITCH_LAN_HOST_PORT)) ports.push(ROUTER_SWITCH_LAN_HOST_PORT);
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
    return out;
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
    return isFabricPort(this.categoryOf(uid), port);
  }

  // 口が機器の一員として数えられないか（中継だけの口）
  isRelay(uid: string, port: number): boolean {
    return isRelayPort(this.categoryOf(uid), port);
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
    const cfg = this.portCfg(uid, port);
    if (cfg?.mode === 'trunk') return cfg.native ?? 1;
    return cfg?.vlan ?? 1;
  }

  // 口がその VLAN のフレームを通すか（access は同じ VLAN、trunk は許可された VLAN）
  carries(uid: string, port: number, vlan: number): boolean {
    const cfg = this.portCfg(uid, port);
    // 設定のない口（機器の口）は、届いたフレームをそのまま受け取る
    if (cfg === undefined) return true;
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
      // 機器の内部のスイッチに入ったら、同じ VLAN を通す口をすべてたどる
      if (this.isFabric(ep.node, ep.port)) {
        for (const port of this.fabricBy.get(ep.node) ?? []) {
          queue.push({ ep: { node: ep.node, port }, vlan });
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
const adOf = (r: Route): number => (r.protocol === 'ospf' ? 110 : r.protocol === 'rip' ? 120 : 1);

// 規則の送信元・宛先（'any' か「a.b.c.d/nn」）に、IPアドレスが入るか
const matchNet = (spec: string, ip: string): boolean => {
  if (spec === 'any') return true;
  const [network, prefix] = spec.split('/');
  return inSubnet(ip, network, Number(prefix));
};

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
const deliver = (topo: Topology, srcUid: string, dstUid: string, traffic: Traffic = { kind: 'ping' }, check = true): PathResult => {
  const path: string[] = [];
  const src = topo.node(srcUid);
  const dst = topo.node(dstUid);
  const err = (failure: Failure): PathResult => ({ ok: false, path, failure });

  if (!src || !dst) return err(fail('ip.unset', srcUid));

  const srcIface = src.interfaces[0];
  if (!srcIface) return err(fail('ip.unset', src.uid));
  const srcEp: Endpoint = { node: src.uid, port: srcIface.port };
  if (topo.isShut(src.uid, srcIface.port)) return err(fail('port.shutdown', src.uid));
  if (!topo.linkAt(srcEp)) return err(fail('link.unplugged', src.uid));
  // 相手の口が停止していれば、その口で止まる（port.shutdown）
  const srcPeer = topo.linkAt(srcEp)!.peer;
  if (topo.isShut(srcPeer.node, srcPeer.port)) return err(fail('port.shutdown', srcPeer.node));

  const dstIface = dst.interfaces[0];
  if (!dstIface) return err(fail('ip.unset', dst.uid));
  const dstEp: Endpoint = { node: dst.uid, port: dstIface.port };
  if (!topo.linkAt(dstEp)) return err(fail('link.unplugged', dst.uid));

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
  for (let hop = 0; hop < MAX_HOPS; hop++) {
    const cur = topo.node(current.node);
    if (!cur) return err(fail('route.none', current.node));

    if (cur.uid === dst.uid) {
      path.push(cur.uid);
      return { ok: true, path };
    }
    if (!topo.isRouter(cur.uid)) return err(fail('route.none', cur.uid));
    path.push(cur.uid);
    // ファイアウォールは、規則に合う通信だけを通す（既定は拒否）
    if (check && topo.categoryOf(cur.uid) === CATEGORY.firewall && !allows(cur.rules, srcIface.ip, dstIface.ip, traffic)) {
      return err(fail('firewall.denied', cur.uid));
    }

    // 直結しているサブネットに宛先があるか
    const connected = cur.interfaces.find((i) => inSubnet(dstIface.ip, i.ip, i.prefix));
    if (connected) {
      const domain = topo.domainOf({ node: cur.uid, port: connected.port });
      if (domain.tooLong) return err(fail('link.too_long', domain.tooLong.node));
      if (domain.loop) return err(fail('link.loop', domain.loop.node));
      if (inDomain(domain, dstEp)) {
        path.push(dst.uid);
        return { ok: true, path };
      }
      return err(fail('ip.unreachable', cur.uid));
    }

    // 最長一致で静的ルートを選ぶ
    // 設定した経路（static）と、RIP・OSPF の経路を合わせ、最長一致で選ぶ。同じ長さなら管理距離（AD）の小さい方（static 1・OSPF 110・RIP 120）
    const matches = [...cur.routes, ...topo.routesOf(cur.uid)].filter((r) => inSubnet(dstIface.ip, r.dest, r.prefix));
    if (matches.length === 0) return err(fail('route.none', cur.uid));
    const route = matches.reduce((best, r) => (r.prefix > best.prefix || (r.prefix === best.prefix && adOf(r) < adOf(best)) ? r : best));

    const egress = cur.interfaces.find((i) => inSubnet(route.nextHop, i.ip, i.prefix));
    if (!egress) return err(fail('route.none', cur.uid));
    const egressDomain = topo.domainOf({ node: cur.uid, port: egress.port });
    if (egressDomain.tooLong) return err(fail('link.too_long', egressDomain.tooLong.node));
    if (egressDomain.loop) return err(fail('link.loop', egressDomain.loop.node));
    const next = egressDomain.members.find((m) => topo.ifaceAt(m.node, m.port)?.ip === route.nextHop);
    if (!next) return err(fail('route.none', cur.uid));
    current = next;
  }
  return err(fail('route.loop', current.node));
};

// Ping（ICMP）の判定。往路と復路の両方が通る必要がある
export const ping = (net: Network, data: EngineData, srcUid: string, dstUid: string): PathResult => {
  const topo = new Topology(net, data);
  const forward = deliver(topo, srcUid, dstUid, { kind: 'ping' });
  if (!forward.ok) return forward;
  const back = deliver(topo, dstUid, srcUid, { kind: 'ping' }, false);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure } };
  }
  return forward;
};

// HTTP の判定。往路で宛先に届き、宛先が指定ポートでサービスを待ち受けていて、復路も通ること
export const http = (net: Network, data: EngineData, srcUid: string, dstUid: string, port: number): PathResult => {
  const topo = new Topology(net, data);
  const forward = deliver(topo, srcUid, dstUid, { kind: 'http', port });
  if (!forward.ok) return forward;
  const dst = topo.node(dstUid);
  if (!dst || !dst.services.some((s) => s.protocol === 'http' && s.port === port)) {
    return { ok: false, path: forward.path, failure: fail('service.closed', dstUid) };
  }
  const back = deliver(topo, dstUid, srcUid, { kind: 'http', port }, false);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure } };
  }
  return forward;
};

// ネットワーク全体の中で、輪になっているL2ドメインがあれば、その輪の機器（スイッチ）の uid を返す。なければ null（社内のネットワークの障害の表示に使う）
export const loopNodeOf = (net: Network, data: EngineData): string | null => {
  const topo = new Topology(net, data);
  for (const link of net.links) {
    for (const ep of [link.a, link.b]) {
      const loop = topo.domainOf(ep).loop;
      if (loop) return loop.node;
    }
  }
  return null;
};
