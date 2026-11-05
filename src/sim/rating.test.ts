import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { rate, rewardRateOf } from './rating';

const balance = balanceJson as unknown as Balance;

describe('遅れた案件の★', () => {
  it('期日内の★3相当の案件は★3のまま', () => {
    expect(rate(70, 100, 0, false, balance)).toBe(3);
  });

  it('遅れた★3相当の案件は★2になる', () => {
    expect(rate(70, 100, 0, true, balance)).toBe(2);
  });

  it('遅れても★1の案件は★1のまま', () => {
    expect(rate(150, 100, 0, true, balance)).toBe(1);
  });
});

describe('★ごとの報酬の倍率', () => {
  it('★3は1.25、★2は1.1、★1は1.0', () => {
    expect(rewardRateOf(3, balance)).toBe(1.25);
    expect(rewardRateOf(2, balance)).toBe(1.1);
    expect(rewardRateOf(1, balance)).toBe(1);
  });
});
