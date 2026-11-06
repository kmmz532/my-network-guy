import { describe, expect, it } from 'vitest';
import type { Balance } from '../data/schema';
import balanceJson from '../assets/data/balance.json';
import { dayOf, grantDailyExp } from './companyExp';
import { dailyExpCapOf, deliveryExpOf, expAmountOf, needOf } from './level';
import { minutesPerDay } from './clock';

const balance = balanceJson as unknown as Balance;
// 経験値 0（Lv1）の状態
const lv10 = { companyExp: 0, expDay: 0, expToday: 0 };

describe('expAmountOf（割合の量。最小は1）', () => {
  it('量は現在のレベルの必要経験値に割合を掛けた値', () => {
    expect(expAmountOf(0.1, 10, balance)).toBe(Math.round(needOf(10, balance) * 0.1));
  });
  it('レベルが上がると、同じ源の量も増える', () => {
    expect(expAmountOf(0.1, 60, balance)).toBeGreaterThan(expAmountOf(0.1, 10, balance));
  });
  it('割合が小さくても、最小は1', () => {
    expect(expAmountOf(0.0001, 1, balance)).toBe(1);
  });
});

describe('grantDailyExp（納品以外の経験値）', () => {
  it('源の量（割合）だけ経験値が増える', () => {
    const r = grantDailyExp(lv10, 'hire', 0, balance);
    expect(r.gained).toBe(expAmountOf(balance.exp.hire, 1, balance));
    expect(r.companyExp).toBe(r.gained);
  });
  it('繰り返せる源は、1日の上限で止まる（上限は現在のレベルの割合）', () => {
    const cap = dailyExpCapOf(1, balance);
    let s = lv10;
    for (let i = 0; i < 100; i++) s = { ...s, ...grantDailyExp(s, 'expansion', 0, balance) };
    expect(s.expToday).toBe(cap);
    expect(grantDailyExp(s, 'furniture', 0, balance).gained).toBe(0);
  });
  it('案内の段階は上限の対象外', () => {
    let s = lv10;
    for (let i = 0; i < 20; i++) s = { ...s, ...grantDailyExp(s, 'guide', 0, balance) };
    expect(s.expToday).toBeGreaterThan(dailyExpCapOf(1, balance));
  });
  it('日が変わると、上限は新しく数え直す', () => {
    const full = { companyExp: 1, expDay: 0, expToday: dailyExpCapOf(1, balance) };
    const next = grantDailyExp(full, 'hire', minutesPerDay, balance);
    expect(dayOf(minutesPerDay)).toBe(1);
    expect(next.gained).toBeGreaterThan(0);
    expect(next.expDay).toBe(1);
  });
});

describe('deliveryExpOf（納品の経験値は解放レベルで決まる）', () => {
  it('解放レベルが高い案件ほど、納品の経験値が多い。最小は1', () => {
    expect(deliveryExpOf(40, balance)).toBeGreaterThan(deliveryExpOf(1, balance));
    expect(deliveryExpOf(1, balance)).toBeGreaterThanOrEqual(1);
  });
});
