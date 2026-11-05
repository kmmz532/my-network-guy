// 席のない社員の歩行（純粋関数）。1秒に1マス、横・縦の順にまっすぐ歩き、目的地に着いたら2〜4秒止まる。
// 家具や機材との衝突は判定しない。位置は保存しない。
export interface Point {
  x: number;
  y: number;
}

export interface Walker {
  // マスの座標（小数は歩いている途中）
  x: number;
  y: number;
  // 目的地までの残りのマス（横に進んでから縦に進む）
  path: Point[];
  // 止まっている残りの時間（ms）
  pause: number;
}

const TILES_PER_MS = 1 / 1000;
const PAUSE_MIN_MS = 2000;
const PAUSE_MAX_MS = 4000;

// 今いるマスから目的地まで、横に進んでから縦に進む経路（出発点は含まない）
export const routeFrom = (from: Point, to: Point): Point[] => {
  const path: Point[] = [];
  let cx = from.x;
  while (cx !== to.x) {
    cx += Math.sign(to.x - cx);
    path.push({ x: cx, y: from.y });
  }
  let cy = from.y;
  while (cy !== to.y) {
    cy += Math.sign(to.y - cy);
    path.push({ x: to.x, y: cy });
  }
  return path;
};

const pauseTime = (rng: () => number): number => PAUSE_MIN_MS + rng() * (PAUSE_MAX_MS - PAUSE_MIN_MS);

// dtMs 経過させた後の状態。floor は歩いてよいマス、rng は 0 以上 1 未満の乱数
export const wanderStep = (w: Walker, dtMs: number, floor: readonly Point[], rng: () => number): Walker => {
  if (w.pause > 0) return { ...w, pause: Math.max(0, w.pause - dtMs) };
  let { x, y, path } = w;
  let budget = dtMs * TILES_PER_MS;
  while (budget > 0) {
    if (path.length === 0) {
      // 歩ける床がなければ、その場にいる
      if (floor.length === 0) return { x, y, path, pause: 0 };
      // 次の目的地を選ぶ。今いるマスに合わせてから出発する
      const here = { x: Math.round(x), y: Math.round(y) };
      x = here.x;
      y = here.y;
      const target = floor[Math.min(floor.length - 1, Math.floor(rng() * floor.length))];
      path = routeFrom(here, target);
      if (path.length === 0) return { x, y, path, pause: pauseTime(rng) };
    }
    const next = path[0];
    const dist = Math.abs(next.x - x) + Math.abs(next.y - y);
    if (budget >= dist) {
      // 次のマスに着く
      x = next.x;
      y = next.y;
      budget -= dist;
      path = path.slice(1);
      if (path.length === 0) return { x, y, path, pause: pauseTime(rng) };
    } else {
      // 途中まで進む
      x += Math.sign(next.x - x) * budget;
      y += Math.sign(next.y - y) * budget;
      budget = 0;
    }
  }
  return { x, y, path, pause: 0 };
};
