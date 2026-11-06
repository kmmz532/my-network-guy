// 社員の出勤と退勤（純粋関数）。終業になると机からドアまで歩いて出て、始業になるとドアから机まで歩いて入る。
// 歩く経路は床とドアのマスだけを通る（壁は通らない）。机や家具は判定しない（歩き回る社員と同じ）。
export interface Point {
  x: number;
  y: number;
}

export type Commute =
  // 机にいる
  | { state: 'seated'; at: Point; path: Point[] }
  // 机からドアへ歩いている
  | { state: 'out'; at: Point; path: Point[] }
  // 外にいる（描かない）
  | { state: 'away'; at: Point; path: Point[] }
  // ドアから机へ歩いている
  | { state: 'in'; at: Point; path: Point[] };

// 1マス歩くのにかかる時間（ms）
export const STEP_MS = 400;

// 出発点から目的地まで、床・ドアのマスだけを通る最短の経路（出発点は含まない）。行けなければ null
export const bfsRoute = (from: Point, to: Point, passable: (x: number, y: number) => boolean): Point[] | null => {
  if (from.x === to.x && from.y === to.y) return [];
  const key = (p: Point) => `${p.x},${p.y}`;
  const prev = new Map<string, Point | null>([[key(from), null]]);
  const queue: Point[] = [from];
  const dirs = [
    { x: 1, y: 0 },
    { x: -1, y: 0 },
    { x: 0, y: 1 },
    { x: 0, y: -1 },
  ];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    for (const d of dirs) {
      const next = { x: cur.x + d.x, y: cur.y + d.y };
      if (prev.has(key(next)) || !passable(next.x, next.y)) continue;
      prev.set(key(next), cur);
      if (next.x === to.x && next.y === to.y) {
        const path: Point[] = [];
        let p: Point | null | undefined = next;
        while (p && !(p.x === from.x && p.y === from.y)) {
          path.unshift(p);
          p = prev.get(key(p));
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
};

// 今の時間帯（working）と机・ドアの位置から、次の状態を決める。dtMs だけ歩かせた後の状態を返す
// door が null（ドアがない）のときは、歩かずに外へ出る・中へ入る
export const commuteStep = (
  c: Commute,
  dtMs: number,
  working: boolean,
  desk: Point,
  door: Point | null,
  route: (from: Point, to: Point) => Point[] | null,
): Commute => {
  let cur = c;
  // 状態の切り替え（歩く途中の状態は、着くまで変えない）
  if (cur.state === 'seated' && !working) {
    const path = door ? route(desk, door) : [];
    if (path === null) return cur;
    cur = path.length === 0 ? { state: 'away', at: door ?? desk, path: [] } : { state: 'out', at: { ...desk }, path };
  } else if (cur.state === 'away' && working) {
    const start = door ?? desk;
    const path = door ? route(start, desk) : [];
    if (path === null) return cur;
    cur = path.length === 0 ? { state: 'seated', at: { ...desk }, path: [] } : { state: 'in', at: { ...start }, path };
  }
  if (cur.state !== 'out' && cur.state !== 'in') return cur;

  // 歩く。1マスずつ、残りの時間の分だけ進める
  let budget = dtMs / STEP_MS;
  let { at, path } = cur;
  let x = at.x;
  let y = at.y;
  while (budget > 0 && path.length > 0) {
    const next = path[0];
    const dist = Math.abs(next.x - x) + Math.abs(next.y - y);
    if (budget >= dist) {
      x = next.x;
      y = next.y;
      budget -= dist;
      path = path.slice(1);
    } else {
      // 途中まで進む（経路は縦か横の一方向）
      const dx = next.x - x;
      const dy = next.y - y;
      x += Math.sign(dx) * budget;
      y += Math.sign(dy) * budget;
      budget = 0;
    }
  }
  at = { x, y };
  if (path.length > 0) return { state: cur.state, at, path };
  // 着いたら、外へ出た・机に座った状態にする
  return cur.state === 'out' ? { state: 'away', at, path: [] } : { state: 'seated', at: { ...desk }, path: [] };
};
