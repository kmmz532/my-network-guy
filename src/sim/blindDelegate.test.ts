// 型紙なしで任せる（結果を乱数で決める）。能力の傾向と、★の上限
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { blindDelegation, costRatioOf, qualityOf, reworkOf, starRangeOf, starsFor } from './blindDelegate';

const balance = balanceJson as unknown as Balance;

describe('型紙なしで任せる', () => {
  it('能力が高いほど、費用の割合の期待値が下がる', () => {
    const low = costRatioOf(qualityOf(1, 4, 0, balance), 0, balance);
    const high = costRatioOf(qualityOf(12, 4, 1, balance), 0, balance);
    expect(high).toBeLessThan(low);
  });

  it('能力が高いほど、手直しの回数が少ない', () => {
    expect(reworkOf(qualityOf(12, 4, 1, balance), 0, balance)).toBeLessThanOrEqual(reworkOf(qualityOf(1, 4, 0, balance), 0, balance));
  });

  it('★は2が上限（3にはならない）', () => {
    for (const cost of [0, 0.5, 1, 2]) for (const rework of [0, 1, 5]) expect(starsFor(cost, rework, balance)).toBeLessThanOrEqual(2);
  });

  it('同じ乱数の状態なら結果は同じ（決定的）', () => {
    const x = blindDelegation(6, 4, 0.5, balance, 42);
    const y = blindDelegation(6, 4, 0.5, balance, 42);
    expect(x).toEqual(y);
    expect(x.rng).not.toBe(42);
  });

  it('予想の★の範囲は、1〜2の中に収まる', () => {
    const [min, max] = starRangeOf(0, 4, 0, balance);
    expect(min).toBe(1);
    expect(max).toBeLessThanOrEqual(2);
  });
});
