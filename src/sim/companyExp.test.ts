import { describe, expect, it } from 'vitest';
import type { Balance } from '../data/schema';
import balanceJson from '../assets/data/balance.json';
import { dayOf, grantDailyExp } from './companyExp';
import { minutesPerDay } from './clock';

const balance = balanceJson as unknown as Balance;
const start = { companyExp: 0, expDay: 0, expToday: 0 };

describe('grantDailyExp（納品以外の経験値。1日の上限あり。N55）', () => {
  it('源の量だけ経験値が増える', () => {
    const r = grantDailyExp(start, 'hire', 0, balance);
    expect(r.gained).toBe(balance.exp.hire);
    expect(r.companyExp).toBe(balance.exp.hire);
    expect(r.expToday).toBe(balance.exp.hire);
  });
  it('同じ日は1日の上限で止まる', () => {
    let s = start;
    for (let i = 0; i < 100; i++) s = { ...s, ...grantDailyExp(s, 'expansion', 0, balance) };
    expect(s.companyExp).toBe(balance.exp.dailyCap);
    expect(grantDailyExp(s, 'furniture', 0, balance).gained).toBe(0);
  });
  it('日が変わると、上限は新しく数え直す', () => {
    const full = { companyExp: balance.exp.dailyCap, expDay: 0, expToday: balance.exp.dailyCap };
    const next = grantDailyExp(full, 'guide', minutesPerDay, balance);
    expect(dayOf(minutesPerDay)).toBe(1);
    expect(next.gained).toBe(balance.exp.guide);
    expect(next.expDay).toBe(1);
  });
  it('上限まで残りがあれば、残りの分だけ入る', () => {
    const almost = { companyExp: 10, expDay: 0, expToday: balance.exp.dailyCap - 1 };
    expect(grantDailyExp(almost, 'hire', 0, balance).gained).toBe(1);
  });
});
