// マップのタイルの種類を引く。空白（' '）は、legend に書いていなければ void（何もない場所）になる。
// legend に ' ' を書けば、その種類にできる。

export const VOID_CHAR = ' ';
export const VOID_KIND = 'void';

// 通れず、機器・家具も置けないマス（壁・壁に掛ける物・柱）。判定はここだけで行う（N51b）
const BLOCKING_KINDS: ReadonlySet<string> = new Set(['wall', 'pillar', 'window', 'clock', 'poster', 'whiteboard']);
export const isBlocked = (kind: string | undefined): boolean => kind !== undefined && BLOCKING_KINDS.has(kind);

export interface TileSource {
  legend: Record<string, string>;
  tiles: readonly string[];
}

// 座標 (x, y) のタイルの種類。範囲の外なら undefined
export const tileKind = (map: TileSource, x: number, y: number): string | undefined => {
  const ch = map.tiles[y]?.[x];
  if (ch === undefined) return undefined;
  if (ch === VOID_CHAR) return map.legend[VOID_CHAR] ?? VOID_KIND;
  return map.legend[ch];
};
