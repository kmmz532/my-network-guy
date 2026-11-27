// 現場の地図の縁の枠（N170）の線分。見えている部屋の部分の外周を、マップの px で求める。純粋な関数で、地図ごとに1回だけ求める。
// 見えている部分は TileMap.ts の描き方に合わせる: 床・柱などのマスは全体、奥の壁（真下が床）は全体、左右と手前の壁は床に接する辺の上面（cap px）だけ、
// 仕切りの壁（左右とも床）は全体。何もない場所（void）と地図の外は見えない。L 字などの部屋でも、外周に沿って枠を引ける
import type { GameMap } from '../data/schema';
import { isWall, tileKind, VOID_KIND } from '../data/tileKind';

export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const cache = new WeakMap<GameMap, Segment[]>();

export const siteOutlineOf = (map: GameMap, cap: number): Segment[] => {
  const cached = cache.get(map);
  if (cached) return cached;
  const ts = map.tileSize;
  const kindAt = (x: number, y: number): string | undefined => (x < 0 || y < 0 || x >= map.width || y >= map.height ? undefined : tileKind(map, x, y));
  const shown = (k: string | undefined): boolean => k !== undefined && k !== VOID_KIND;
  const floorAt = (x: number, y: number): boolean => {
    const k = kindAt(x, y);
    return shown(k) && !isWall(k);
  };
  // マスの中の画素 (ix, iy)（0〜ts-1）が見えるか
  const visibleIn = (tx: number, ty: number, ix: number, iy: number): boolean => {
    const k = kindAt(tx, ty);
    if (!shown(k)) return false;
    if (!isWall(k)) return true;
    // 奥の壁の正面と、仕切りの壁は全体が見える
    if (floorAt(tx, ty + 1) || (floorAt(tx - 1, ty) && floorAt(tx + 1, ty))) return true;
    const left = ix < cap;
    const right = ix >= ts - cap;
    const top = iy < cap;
    const bottom = iy >= ts - cap;
    if (left && floorAt(tx - 1, ty)) return true;
    if (right && floorAt(tx + 1, ty)) return true;
    if (top && floorAt(tx, ty - 1)) return true;
    // 角: 斜めに床があれば、その角の cap × cap が見える（上面どうしをつなぐ）
    if (left && top && floorAt(tx - 1, ty - 1)) return true;
    if (right && top && floorAt(tx + 1, ty - 1)) return true;
    if (left && bottom && floorAt(tx - 1, ty + 1)) return true;
    if (right && bottom && floorAt(tx + 1, ty + 1)) return true;
    return false;
  };
  const w = map.width * ts;
  const h = map.height * ts;
  const at = (px: number, py: number): boolean => px >= 0 && py >= 0 && px < w && py < h && visibleIn(Math.floor(px / ts), Math.floor(py / ts), px % ts, py % ts);
  const segments: Segment[] = [];
  // 横の境目（py の上と下で見え方が違う画素の並び）を、続く範囲ごとに1本の線分にまとめる
  for (let py = 0; py <= h; py++) {
    let start = -1;
    for (let px = 0; px <= w; px++) {
      const edge = px < w && at(px, py - 1) !== at(px, py);
      if (edge && start < 0) start = px;
      if (!edge && start >= 0) {
        segments.push({ x1: start, y1: py, x2: px, y2: py });
        start = -1;
      }
    }
  }
  // 縦の境目
  for (let px = 0; px <= w; px++) {
    let start = -1;
    for (let py = 0; py <= h; py++) {
      const edge = py < h && at(px - 1, py) !== at(px, py);
      if (edge && start < 0) start = py;
      if (!edge && start >= 0) {
        segments.push({ x1: px, y1: start, x2: px, y2: py });
        start = -1;
      }
    }
  }
  cache.set(map, segments);
  return segments;
};
