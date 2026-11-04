// 決定的な乱数（mulberry32）。状態を値として持ち、セーブに含められるように純粋関数で書く。
export interface RandResult {
  value: number; // [0, 1)
  state: number;
}

export const rand = (state: number): RandResult => {
  const next = (state + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return { value: ((t ^ (t >>> 14)) >>> 0) / 4294967296, state: next };
};

// min 以上 max 以下の整数
export const randInt = (state: number, min: number, max: number): { value: number; state: number } => {
  const r = rand(state);
  return { value: min + Math.floor(r.value * (max - min + 1)), state: r.state };
};
