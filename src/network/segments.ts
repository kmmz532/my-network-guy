// セグメント（配線とスイッチでつながった機器の集まり）の算出と、セグメントの設定の参照。
// セグメントは代表端点（セグメント内で最も小さい機器のUIDとポート）の鍵 "uid:port" で設定を持つ。仕様は memo/sim-3.md を参照する。
import { ipToInt } from './engine';
import { isFabricPort, isL3FabricPort, isRelayPort, isRoutingCategory, isSwitchedRouterCategory, ROUTER_SWITCH_LAN_HOST_PORT, sviPortOf } from './category';
import type { EngineData, Endpoint, NetNode, Network, SegmentConfig } from './types';
import { deviceCategory } from '../registry/query';

// 設定できるプレフィックス長（sim-3 の候補）
export const PREFIX_MIN = 24;
export const PREFIX_MAX = 30;

export interface Segment {
  // 代表端点の鍵（"uid:port"）。設定の鍵にする
  key: string;
  // セグメントに属する機器の端点（スイッチは含めない。ルーターのポートは含む）。uid・ポートの昇順
  members: Endpoint[];
}

export const epKey = (node: string, port: number): string => `${node}:${port}`;

const maskOf = (prefix: number): number => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

export const intToIp = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

// IPアドレスとプレフィックス長から、ネットワークアドレスを求める
export const networkAddress = (ip: string, prefix: number): string => intToIp((ipToInt(ip) & maskOf(prefix)) >>> 0);

// ホストに割り当てられるアドレスの数（ネットワークアドレスとブロードキャストアドレスを除く）
export const hostCapacity = (prefix: number): number => Math.max(0, 2 ** (32 - prefix) - 2);

const byEndpoint = (a: Endpoint, b: Endpoint): number => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.port - b.port);

// 配線とスイッチでつながった端点を、セグメントにまとめる。機器のない組（スイッチだけ）はセグメントにしない
export const segmentsOf = (net: Pick<Network, 'nodes' | 'links'>, _data: EngineData): Segment[] => {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const categoryOf = new Map(net.nodes.map((n) => [n.uid, deviceCategory(n.device)]));
  const cat = (uid: string) => categoryOf.get(uid) ?? '';
  const nodeOf = new Map(net.nodes.map((n) => [n.uid, n]));
  // 口が機器の内部のスイッチにつながるか（L3スイッチの access・trunk の口を含む・N138）
  const cfgOf = (uid: string, port: number) => nodeOf.get(uid)?.ports?.find((p) => p.port === port);
  const hasIpOf = (uid: string, port: number): boolean => (nodeOf.get(uid)?.interfaces ?? []).some((i) => i.kind === 'port' && i.port === port);
  const l3Fabric = (uid: string, port: number): boolean => isL3FabricPort(cat(uid), port, cfgOf(uid, port), hasIpOf(uid, port));
  const fabricOf = (uid: string, port: number): boolean => isFabricPort(cat(uid), port) || l3Fabric(uid, port);
  // L3スイッチの access の口は VLAN ごとにまとめる（SVI と同じ VLAN のセグメントになる）。L2 と trunk は機器ごと
  const fabricKey = (uid: string, port: number): string => {
    const cfg = cfgOf(uid, port);
    return cat(uid) === 'l3_switch' && l3Fabric(uid, port) && (cfg === undefined || cfg.mode === 'access') ? `${uid}#${cfg?.vlan ?? 1}` : uid;
  };

  const endpoints = new Map<string, Endpoint>();
  for (const link of net.links) {
    const a = epKey(link.a.node, link.a.port);
    const b = epKey(link.b.node, link.b.port);
    endpoints.set(a, link.a);
    endpoints.set(b, link.b);
    union(a, b);
  }
  // スイッチ付きルーターは、LAN の口につながっていれば代表の LAN 口もセグメントに含める（アドレスを持つ口）
  for (const ep of [...endpoints.values()]) {
    if (!isFabricPort(cat(ep.node), ep.port) || !isSwitchedRouterCategory(cat(ep.node))) continue;
    const host = { node: ep.node, port: ROUTER_SWITCH_LAN_HOST_PORT };
    endpoints.set(epKey(host.node, host.port), host);
  }
  // 機器の内部のスイッチにつながる口は、同じ機器のものすべてを同じセグメントにする
  const fabricFirst = new Map<string, string>();
  for (const ep of endpoints.values()) {
    if (!fabricOf(ep.node, ep.port)) continue;
    const k = epKey(ep.node, ep.port);
    const fk = fabricKey(ep.node, ep.port);
    const first = fabricFirst.get(fk);
    if (first) union(k, first);
    else fabricFirst.set(fk, k);
  }
  // SVI（VLAN のインターフェース・N138）は、同じ VLAN の口のセグメントに入る
  for (const node of net.nodes) {
    for (const i of node.interfaces) {
      if (i.kind !== 'svi' || i.vlan === undefined) continue;
      const k = epKey(node.uid, sviPortOf(i.vlan));
      endpoints.set(k, { node: node.uid, port: sviPortOf(i.vlan) });
      const first = fabricFirst.get(`${node.uid}#${i.vlan}`);
      if (first) union(k, first);
      else fabricFirst.set(`${node.uid}#${i.vlan}`, k);
    }
  }

  const groups = new Map<string, Endpoint[]>();
  for (const ep of endpoints.values()) {
    const root = find(epKey(ep.node, ep.port));
    groups.set(root, [...(groups.get(root) ?? []), ep]);
  }
  const segments: Segment[] = [];
  for (const eps of groups.values()) {
    const members = eps.filter((ep) => !isRelayPort(cat(ep.node), ep.port) && !l3Fabric(ep.node, ep.port)).sort(byEndpoint);
    if (members.length === 0) continue;
    segments.push({ key: epKey(members[0].node, members[0].port), members });
  }
  return segments.sort((a, b) => (a.key < b.key ? -1 : 1));
};

// 機器のポートが属するセグメント（配線がなければ undefined）
export const segmentOf = (segments: Segment[], node: string, port: number): Segment | undefined =>
  segments.find((s) => s.members.some((m) => m.node === node && m.port === port));

// セグメントの設定。案件で設定が固定された機器（配線の設定が固定された機器）を含むときは、その機器のアドレスから決める。
// そのほかは保存された設定を使う。
export const segmentConfigOf = (
  seg: Segment,
  nodes: Map<string, NetNode>,
  explicit?: Record<string, SegmentConfig>,
): SegmentConfig | undefined => {
  for (const m of seg.members) {
    const node = nodes.get(m.node);
    if (!node?.configLocked) continue;
    const iface = node.interfaces.find((i) => i.port === m.port);
    if (iface) return { network: networkAddress(iface.ip, iface.prefix), prefix: iface.prefix };
  }
  return explicit?.[seg.key];
};

// 設定のないセグメントに、IPアドレスのある機器から設定を作る（そのセグメントで最も小さい機器のアドレスのネットワーク）。
// 保存された設定は残す。配線の後にIPアドレスを入力したときや、配線を外して分かれたときに使う
export const fillSegments = (net: Network, data: EngineData): Record<string, SegmentConfig> => {
  const nodes = new Map(net.nodes.map((n) => [n.uid, n]));
  const out: Record<string, SegmentConfig> = { ...(net.segments ?? {}) };
  for (const seg of segmentsOf(net, data)) {
    if (segmentConfigOf(seg, nodes, out)) continue;
    for (const m of seg.members) {
      const iface = nodes.get(m.node)?.interfaces.find((i) => i.port === m.port);
      if (iface) {
        out[seg.key] = { network: networkAddress(iface.ip, iface.prefix), prefix: iface.prefix };
        break;
      }
    }
  }
  return out;
};

// セグメントの中のルーターのポートのアドレス（自分の機器を除き、昇順）
const routerIpsOf = (members: Endpoint[], net: Pick<Network, 'nodes'>, _data: EngineData, self: string): string[] => {
  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  const ips = new Set<string>();
  for (const m of members) {
    if (m.node === self) continue;
    const node = byUid.get(m.node);
    if (!node || !isRoutingCategory(deviceCategory(node.device))) continue;
    const iface = node.interfaces.find((i) => i.port === m.port);
    if (iface) ips.add(iface.ip);
  }
  return [...ips].sort((a, b) => ipToInt(a) - ipToInt(b));
};

// 機器のポートと同じセグメントにあるルーターのアドレス。ホストのデフォルトゲートウェイの候補に使う
export const routerAddressesOn = (net: Network, data: EngineData, uid: string, port: number): string[] => {
  const seg = segmentOf(segmentsOf(net, data), uid, port);
  return seg ? routerIpsOf(seg.members, net, data, uid) : [];
};

// 機器がつながるセグメントにあるルーターのアドレス（自分を除く）。静的ルートのネクストホップの候補に使う
export const neighborRouterAddresses = (net: Network, data: EngineData, uid: string): string[] => {
  const members = segmentsOf(net, data)
    .filter((seg) => seg.members.some((m) => m.node === uid))
    .flatMap((seg) => seg.members);
  return routerIpsOf(members, net, data, uid);
};
