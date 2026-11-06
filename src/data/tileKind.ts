// マップのタイルの種類を引く。空白（' '）は、legend に書いていなければ void（何もない場所）になる。
// legend に ' ' を書けば、その種類にできる。

export const VOID_CHAR = ' ';
export const VOID_KIND = 'void';

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
