// 時刻による画面の色（N75）
import { describe, expect, it } from 'vitest';
import { dayTintOf, nightnessOf, toHex } from './dayTint';

const at = (hour: number) => dayTintOf(hour * 60);

describe('時刻による画面の色（N75）', () => {
  it('昼（9〜16時）はそのまま（白）', () => {
    expect(at(12)).toEqual({ r: 1, g: 1, b: 1 });
    expect(nightnessOf(at(12))).toBe(0);
  });

  it('夕方（17〜18時）は暖色（青が弱い）', () => {
    const c = at(17.5);
    expect(c.b).toBeLessThan(c.r);
  });

  it('夜（20〜5時）は青みを帯びて暗い。明るさの下限は 75%', () => {
    const c = at(23);
    expect(c.b).toBeGreaterThan(c.r);
    for (const h of [0, 2, 5, 22]) {
      const n = at(h);
      expect(Math.min(n.r, n.g, n.b)).toBeGreaterThanOrEqual(0.75);
    }
    expect(nightnessOf(c)).toBeGreaterThan(0.2);
  });

  it('時刻の間は、直線で変わる（6時と9時の間は途中の色）', () => {
    const mid = at(7.5);
    expect(mid.b).toBeGreaterThan(0.85);
    expect(mid.b).toBeLessThan(1);
  });

  it('1日を超える分は、1日の中に回して求める', () => {
    expect(dayTintOf(12 * 60 + 1440)).toEqual(dayTintOf(12 * 60));
  });

  it('pixi の色（0xRRGGBB）にする', () => {
    expect(toHex({ r: 1, g: 0, b: 0 })).toBe(0xff0000);
  });
});
