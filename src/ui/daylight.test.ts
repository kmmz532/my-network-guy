// 昼夜の画面の暗さ
import { describe, expect, it } from 'vitest';
import { MAX_SHADE, nightShade } from './daylight';

describe('昼夜の画面の暗さ', () => {
  it('昼（8時から17時まで）は暗くしない', () => {
    expect(nightShade(8)).toBe(0);
    expect(nightShade(12.5)).toBe(0);
    expect(nightShade(16.9)).toBe(0);
  });

  it('夜（20時から6時まで）は最大の暗さ', () => {
    expect(nightShade(20)).toBe(MAX_SHADE);
    expect(nightShade(0)).toBe(MAX_SHADE);
    expect(nightShade(5.9)).toBe(MAX_SHADE);
  });

  it('夕方と朝は、なめらかに変わる（境目で飛ばない）', () => {
    expect(nightShade(7)).toBeCloseTo(MAX_SHADE / 2, 9);
    expect(nightShade(6)).toBeCloseTo(MAX_SHADE, 9);
    expect(nightShade(18.5)).toBeCloseTo(MAX_SHADE / 2, 9);
    expect(nightShade(17)).toBe(0);
  });

  it('24時間を超える時刻は、0時から数える', () => {
    expect(nightShade(24 + 12)).toBe(0);
  });
});
