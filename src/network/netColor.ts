// ネットワークアドレスごとの色（表示だけに使う）。色で設定する操作はない。
// 色は、ネットワークアドレスの小さい順に旧の6色のパレットを順に割り当てる。
// ケーブルは、両端の機器のアドレスがそのセグメントのネットワークに入っているときだけ色を付け、未設定・食い違いは灰色にする。
import { inSubnet, ipToInt } from './engine';
import { epKey, segmentConfigOf, segmentsOf, type Segment } from './segments';
import type { EngineData, Network, SegmentConfig } from './types';

// サブネットの色（旧の6色のパレット）
export const NET_PALETTE = [0x62c4ff, 0xf2c44e, 0x9b7be0, 0x5aa860, 0xff8fb0, 0xf0a030];
// 未設定・食い違いの灰色
export const UNSET_COLOR = 0x9a9a9a;

export interface NetworkColors {
  // ネットワークアドレス → パレットの番号（0 始まり）
  index: Map<string, number>;
  // ケーブルの uid → 表すネットワークアドレス（未設定・食い違いは null）
  linkNetwork: Map<string, string | null>;
}

// 色の番号（0 始まり）からパレットの色を引く
export const colorAt = (index: number): number => NET_PALETTE[index % NET_PALETTE.length];

// 設定されたセグメントのネットワークごとに色を決め、ケーブルがどのネットワークを表すかを求める
export const networkColors = (net: Network, data: EngineData): NetworkColors => {
  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  const segs = segmentsOf(net, data);
  const cfgOf = new Map<string, SegmentConfig>();
  const segOf = new Map<string, Segment>();
  for (const seg of segs) {
    const cfg = segmentConfigOf(seg, byUid, net.segments);
    if (cfg) cfgOf.set(seg.key, cfg);
    for (const m of seg.members) segOf.set(epKey(m.node, m.port), seg);
  }

  const networks = [...new Set([...cfgOf.values()].map((c) => c.network))].sort((a, b) => ipToInt(a) - ipToInt(b));
  const index = new Map(networks.map((n, i) => [n, i]));

  const linkNetwork = new Map<string, string | null>();
  for (const link of net.links) {
    const seg = segOf.get(epKey(link.a.node, link.a.port));
    const cfg = seg ? cfgOf.get(seg.key) : undefined;
    if (!cfg) {
      linkNetwork.set(link.uid, null);
      continue;
    }
    // 両端の機器（スイッチを除く）のアドレスが、このネットワークに入っていること
    const agrees = [link.a, link.b].every((ep) => {
      const node = byUid.get(ep.node);
      if (!node || data.categoryOf(node.device) === 'l2_switch') return true;
      const iface = node.interfaces.find((i) => i.port === ep.port);
      return iface !== undefined && inSubnet(iface.ip, cfg.network, cfg.prefix);
    });
    linkNetwork.set(link.uid, agrees ? cfg.network : null);
  }
  return { index, linkNetwork };
};

// ネットワークアドレスの色（番号）。未設定なら undefined
export const colorOfNetwork = (colors: NetworkColors, network: string | null | undefined): number | undefined => {
  if (network === null || network === undefined) return undefined;
  const i = colors.index.get(network);
  return i === undefined ? undefined : colorAt(i);
};

// ケーブルの色。未設定・食い違いは灰色
export const colorOfLink = (colors: NetworkColors, linkUid: string): number =>
  colorOfNetwork(colors, colors.linkNetwork.get(linkUid)) ?? UNSET_COLOR;
