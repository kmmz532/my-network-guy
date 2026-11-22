// 定型案件の重みの減り方（levelDecayOf）。解放の直後は 1、halfLife 上がるごとに半分、下限は floor
import { describe, expect, it } from 'vitest';
import { levelDecayOf } from './offers';

const decay = { floor: 0.2, halfLife: 15 };

describe('levelDecayOf', () => {
  it('解放の直後は 1', () => {
    expect(levelDecayOf(10, 10, decay)).toBe(1);
  });
  it('halfLife 上がると半分になる', () => {
    expect(levelDecayOf(25, 10, decay)).toBeCloseTo(0.5, 10);
  });
  it('下限より下がらない', () => {
    expect(levelDecayOf(50, 1, decay)).toBe(0.2);
  });
});
