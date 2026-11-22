// マップのタイルの種類を引く。空白（' '）は、legend に書いていなければ void（何もない場所）になる。
// legend に ' ' を書けば、その種類にできる。

export const VOID_CHAR = ' ';
export const VOID_KIND = 'void';

// 通れず、機器・家具も置けないマス（壁・壁に掛ける物・柱・カウンター・本棚・倉庫の棚）。判定はここだけで行う（N51b）
const BLOCKING_KINDS: ReadonlySet<string> = new Set(['wall', 'pillar', 'counter', 'shelf', 'rack', 'window', 'clock', 'poster', 'whiteboard']);
export const isBlocked = (kind: string | undefined): boolean => kind !== undefined && BLOCKING_KINDS.has(kind);

// ケーブルだけが通れるマス。点検口（hatch）は部屋の境の壁の上にあり、shaft（配線用の縦の穴）は階と階をつなぐ。機器・家具は置けない
const CABLE_ONLY_KINDS: ReadonlySet<string> = new Set(['hatch', 'shaft']);
export const isCableOnly = (kind: string | undefined): boolean => kind !== undefined && CABLE_ONLY_KINDS.has(kind);

// 配線の道筋が通れるマス（床と、ケーブルだけが通れるマス）。壁は通れない
export const isCablePassable = (kind: string | undefined): boolean => kind === 'floor' || isCableOnly(kind);

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
