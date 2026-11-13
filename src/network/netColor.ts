// ネットワークアドレスごとの色（表示だけに使う）。色で設定する操作はない。
// 色は、ネットワークアドレスの小さい順に旧の6色のパレットを順に割り当てる。
// ケーブルは、両端の機器のアドレスがそのセグメントのネットワークに入っているときだけ色を付け、未設定・食い違いは灰色にする。

// サブネットの色（旧の6色のパレット）
export const NET_PALETTE = [0x62c4ff, 0xf2c44e, 0x9b7be0, 0x5aa860, 0xff8fb0, 0xf0a030];
// 未設定・食い違いの灰色
export const UNSET_COLOR = 0x9a9a9a;

export interface NetworkColors {
  // ネットワークアドレス → パレットの番号（0 始まり）
  index: Map<string, number>;
  // ケーブルの uid → 表すネットワークアドレス（未設定・食い違いは null）
  linkNetwork: Map<string, string | null>;
  // ケーブルが運ぶネットワーク。現在の単一セグメントは1件、将来のトランクは複数件。
  linkNetworks?: Map<string, string[]>;
  networkPrefix?: Map<string, number>;
}
// 色の番号（0 始まり）からパレットの色を引く
export const colorAt = (index: number): number => NET_PALETTE[index % NET_PALETTE.length];

export const networksOfLink = (colors: NetworkColors, linkUid: string): string[] =>
  colors.linkNetworks?.get(linkUid) ?? (colors.linkNetwork.get(linkUid) ? [colors.linkNetwork.get(linkUid)!] : []);

export const networkLabelOf = (colors: NetworkColors, network: string): string =>
  `${network}/${colors.networkPrefix?.get(network) ?? 24}`;

// ネットワークアドレスの色（番号）。未設定なら undefined
export const colorOfNetwork = (colors: NetworkColors, network: string | null | undefined): number | undefined => {
  if (network === null || network === undefined) return undefined;
  const i = colors.index.get(network);
  return i === undefined ? undefined : colorAt(i);
};

// ケーブルの色。未設定・食い違いは灰色
export const colorOfLink = (colors: NetworkColors, linkUid: string): number =>
  colorOfNetwork(colors, colors.linkNetwork.get(linkUid)) ?? UNSET_COLOR;
