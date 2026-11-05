// 疎通判定（Ping / HTTP）
// L1（配線）→ L2（スイッチによるL2ドメイン）→ L3（IPアドレスとルーティング）の順に確認する。
// 失敗理由は ID で返し、文言は言語ファイルで表示する。
import { isFabricPort, isRelayPort, isRoutingCategory, ROUTER_SWITCH_LAN_HOST_PORT } from './category';
import type { EngineData, Endpoint, Failure, FailureReason, NetLink, NetNode, Network, PathResult } from './types';

const MAX_HOPS = 16;

export const ipToInt = (ip: string): number =>
  ip.split('.').reduce((acc, octet) => ((acc << 8) + Number(octet)) >>> 0, 0);

const maskOf = (prefix: number): number => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

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
      if (this.categoryOf(uid) === 'router_switch' && !ports.includes(ROUTER_SWITCH_LAN_HOST_PORT)) ports.push(ROUTER_SWITCH_LAN_HOST_PORT);
      this.fabricBy.set(uid, ports);
    }
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

  // 端点と同じL2ドメインに属する機器の端点を集める。スイッチは中継するだけで、結果には含めない。
  domainOf(start: Endpoint): DomainResult {
    const members: Endpoint[] = [];
    const visited = new Set<string>();
    const queue: Endpoint[] = [start];
    // 同じL2ドメインの配線の数と機器の数。機器を頂点、配線を辺と見て、辺が頂点以上あれば輪になっている
    const cables = new Set<string>();
    const devices = new Set<string>();
    let relay: Endpoint | undefined;
    let tooLong: Endpoint | undefined;

    while (queue.length) {
      const ep = queue.shift()!;
      const k = key(ep);
      if (visited.has(k)) continue;
      visited.add(k);
      devices.add(ep.node);

      if (!this.isRelay(ep.node, ep.port)) {
        members.push(ep);
      }
      if (this.isFabric(ep.node, ep.port)) relay ??= ep;
      const linked = this.linkAt(ep);
      if (linked) {
        const { link, peer } = linked;
        cables.add(link.uid);
        if (!tooLong && linkLength(link.path) > this.data.maxLengthOf(link.cable)) {
          tooLong = ep;
        }
        queue.push(peer);
      }
      // 機器の内部のスイッチに入ったら、同じスイッチにつながる口をすべてたどる
      if (this.isFabric(ep.node, ep.port)) {
        for (const port of this.fabricBy.get(ep.node) ?? []) {
          queue.push({ node: ep.node, port });
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
const deliver = (topo: Topology, srcUid: string, dstUid: string): PathResult => {
  const path: string[] = [];
  const src = topo.node(srcUid);
  const dst = topo.node(dstUid);
  const err = (failure: Failure): PathResult => ({ ok: false, path, failure });

  if (!src || !dst) return err(fail('ip.unset', srcUid));

  const srcIface = src.interfaces[0];
  if (!srcIface) return err(fail('ip.unset', src.uid));
  const srcEp: Endpoint = { node: src.uid, port: srcIface.port };
  if (!topo.linkAt(srcEp)) return err(fail('link.unplugged', src.uid));

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
    const matches = cur.routes.filter((r) => inSubnet(dstIface.ip, r.dest, r.prefix));
    if (matches.length === 0) return err(fail('route.none', cur.uid));
    const route = matches.reduce((best, r) => (r.prefix > best.prefix ? r : best));

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
  const forward = deliver(topo, srcUid, dstUid);
  if (!forward.ok) return forward;
  const back = deliver(topo, dstUid, srcUid);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure } };
  }
  return forward;
};

// HTTP の判定。往路で宛先に届き、宛先が指定ポートでサービスを待ち受けていて、復路も通ること
export const http = (net: Network, data: EngineData, srcUid: string, dstUid: string, port: number): PathResult => {
  const topo = new Topology(net, data);
  const forward = deliver(topo, srcUid, dstUid);
  if (!forward.ok) return forward;
  const dst = topo.node(dstUid);
  if (!dst || !dst.services.some((s) => s.protocol === 'http' && s.port === port)) {
    return { ok: false, path: forward.path, failure: fail('service.closed', dstUid) };
  }
  const back = deliver(topo, dstUid, srcUid);
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
