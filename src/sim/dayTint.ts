// 時刻による画面の色（N75）。マップに重ねる色（乗算）を、時刻から求める。純粋な関数。
// 昼（9〜16時）はそのまま（白）。6時は朝の淡い橙、17〜18時は夕方の暖色、20〜5時は夜の青み。夜の明るさの下限は 75%。

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

// 時刻（時）と色の対応。間は線形に補間する。0時と24時は同じ
const NIGHT: Rgb = { r: 0.75, g: 0.8, b: 0.97 };
const KEYS: { hour: number; color: Rgb }[] = [
  { hour: 0, color: NIGHT },
  { hour: 5, color: NIGHT },
  { hour: 6, color: { r: 1, g: 0.93, b: 0.85 } },
  { hour: 9, color: { r: 1, g: 1, b: 1 } },
  { hour: 16, color: { r: 1, g: 1, b: 1 } },
  { hour: 17, color: { r: 1, g: 0.85, b: 0.7 } },
  { hour: 18, color: { r: 1, g: 0.85, b: 0.7 } },
  { hour: 20, color: NIGHT },
  { hour: 24, color: NIGHT },
];

// 1日の中の分から、重ねる色を求める（範囲の外の分は、1日の中に回す）
export const dayTintOf = (minuteOfDay: number): Rgb => {
  const hour = (((minuteOfDay % 1440) + 1440) % 1440) / 60;
  for (let i = 0; i < KEYS.length - 1; i++) {
    const a = KEYS[i];
    const b = KEYS[i + 1];
    if (hour >= a.hour && hour <= b.hour) {
      const t = (hour - a.hour) / (b.hour - a.hour);
      return {
        r: a.color.r + (b.color.r - a.color.r) * t,
        g: a.color.g + (b.color.g - a.color.g) * t,
        b: a.color.b + (b.color.b - a.color.b) * t,
      };
    }
  }
  return { r: 1, g: 1, b: 1 };
};

// 夜らしさ（0〜1）。白（昼）は0、夜の色は1に近い。夜の照明を出すかの判定に使う
export const nightnessOf = (c: Rgb): number => Math.max(0, Math.min(1, 1 - (c.r + c.g) / 2));

// 重ねの色を、pixi の色（0xRRGGBB）にする
export const toHex = (c: Rgb): number => (Math.round(c.r * 255) << 16) | (Math.round(c.g * 255) << 8) | Math.round(c.b * 255);
