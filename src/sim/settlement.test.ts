import { describe, expect, it } from 'vitest';
import { balance } from 'virtual:game-data';
import { blindCostOf, settlementOf } from './settlement';

const base = { reward: 100000, unlockLevel: 1, stars: 3 as const, lateDays: 0, delegated: false, companyExp: 0 };

describe('納品の精算', () => {
  it('報酬は★の倍率で決まり、遅れると減る', () => {
    expect(settlementOf(base, balance).money).toBe(125000);
    expect(settlementOf({ ...base, stars: 2 }, balance).money).toBe(110000);
    expect(settlementOf({ ...base, lateDays: 2 }, balance).money).toBe(100000);
  });
  it('任せた依頼の経験値は balance.delegate.expDivisor で割り、最小は1', () => {
    const own = settlementOf(base, balance).expGain;
    expect(settlementOf({ ...base, delegated: true }, balance).expGain).toBe(Math.max(1, Math.floor(own / balance.delegate.expDivisor)));
    expect(settlementOf({ ...base, delegated: true, unlockLevel: 1, stars: 1 }, { ...balance, delegate: { ...balance.delegate, expDivisor: 1e9 } }).expGain).toBe(1);
  });
  it('型紙なしの費用は予算に割合を掛ける', () => {
    expect(blindCostOf(100000, 0.6)).toBe(60000);
  });
});
