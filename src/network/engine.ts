// 疎通判定（Ping / HTTP）
// L1（配線）→ L2（スイッチによるL2ドメイン）→ L3（IPアドレスとルーティング）の順に確認する。
// 失敗理由は ID で返し、文言は言語ファイルで表示する。
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
}

class Topology {
  private nodes = new Map<string, NetNode>();
  private linkByEndpoint = new Map<string, { link: NetLink; peer: Endpoint }>();
  private portsBySwitch = new Map<string, number[]>();

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
      if (this.isSwitch(node)) {
        const ports = this.portsBySwitch.get(node) ?? [];
        ports.push(Number(port));
        this.portsBySwitch.set(node, ports);
      }
    }
  }

  node(uid: string): NetNode | undefined {
    return this.nodes.get(uid);
  }

  isSwitch(uid: string): boolean {
    const node = this.nodes.get(uid);
    return !!node && this.data.categoryOf(node.device) === 'l2_switch';
  }

  isRouter(uid: string): boolean {
    const node = this.nodes.get(uid);
    return !!node && this.data.categoryOf(node.device) === 'router';
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
    let tooLong: Endpoint | undefined;

    while (queue.length) {
      const ep = queue.shift()!;
      const k = key(ep);
      if (visited.has(k)) continue;
      visited.add(k);

      if (!this.isSwitch(ep.node)) {
        members.push(ep);
      }
      const linked = this.linkAt(ep);
      if (linked) {
        const { link, peer } = linked;
        if (!tooLong && linkLength(link.path) > this.data.maxLengthOf(link.cable)) {
          tooLong = ep;
        }
        queue.push(peer);
      }
      if (this.isSwitch(ep.node)) {
        for (const port of this.portsBySwitch.get(ep.node) ?? []) {
          queue.push({ node: ep.node, port });
        }
      }
    }
    return { members, tooLong };
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
