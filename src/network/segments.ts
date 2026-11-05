// セグメント（配線とスイッチでつながった機器の集まり）の算出と、セグメントの設定の参照。
// セグメントは代表端点（セグメント内で最も小さい機器のUIDとポート）の鍵 "uid:port" で設定を持つ。仕様は memo/sim-3.md を参照する。
import { ipToInt } from './engine';
import type { EngineData, Endpoint, NetNode, Network, SegmentConfig } from './types';

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
export const segmentsOf = (net: Pick<Network, 'nodes' | 'links'>, data: EngineData): Segment[] => {
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
  const categoryOf = new Map(net.nodes.map((n) => [n.uid, data.categoryOf(n.device)]));
  const isSwitch = (uid: string) => categoryOf.get(uid) === 'l2_switch';

  const endpoints = new Map<string, Endpoint>();
  for (const link of net.links) {
    const a = epKey(link.a.node, link.a.port);
    const b = epKey(link.b.node, link.b.port);
    endpoints.set(a, link.a);
    endpoints.set(b, link.b);
    union(a, b);
  }
  // スイッチのポートはすべて同じセグメントにする
  const switchFirst = new Map<string, string>();
  for (const ep of endpoints.values()) {
    if (!isSwitch(ep.node)) continue;
    const k = epKey(ep.node, ep.port);
    const first = switchFirst.get(ep.node);
    if (first) union(k, first);
    else switchFirst.set(ep.node, k);
  }

  const groups = new Map<string, Endpoint[]>();
  for (const ep of endpoints.values()) {
    const root = find(epKey(ep.node, ep.port));
    groups.set(root, [...(groups.get(root) ?? []), ep]);
  }
  const segments: Segment[] = [];
  for (const eps of groups.values()) {
    const members = eps.filter((ep) => !isSwitch(ep.node)).sort(byEndpoint);
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
