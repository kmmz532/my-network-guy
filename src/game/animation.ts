// 経路に沿った移動の計算。描画とは独立させ、テストできるようにする。
export interface Point {
  x: number;
  y: number;
}

// 各点までの道のり（先頭は 0）
export const cumulativeLengths = (points: readonly Point[]): number[] => {
  const out = [0];
  for (let i = 1; i < points.length; i++) {
    const dx = points[i].x - points[i - 1].x;
    const dy = points[i].y - points[i - 1].y;
    out.push(out[i - 1] + Math.hypot(dx, dy));
  }
  return out;
};

// 経路上で、先頭から道のり d の位置。d は 0 以上、経路の長さ以下に丸める
export const pointAt = (points: readonly Point[], cumulative: readonly number[], d: number): Point => {
  const total = cumulative[cumulative.length - 1] ?? 0;
  const dist = Math.min(Math.max(d, 0), total);
  for (let i = 1; i < points.length; i++) {
    if (dist <= cumulative[i]) {
      const seg = cumulative[i] - cumulative[i - 1];
      const t = seg === 0 ? 0 : (dist - cumulative[i - 1]) / seg;
      return {
        x: points[i - 1].x + (points[i].x - points[i - 1].x) * t,
        y: points[i - 1].y + (points[i].y - points[i - 1].y) * t,
      };
    }
  }
  return { ...points[points.length - 1] };
};

// 2点の距離と中点
export const distOf = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
export const midOf = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
