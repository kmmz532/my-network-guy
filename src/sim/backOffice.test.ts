// 内勤の効果（職種・割引率・営業の依頼の数）
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { accountingRate, isBackOffice, salesExtraArrivals } from './backOffice';

const balance = balanceJson as unknown as Balance;

describe('内勤の効果', () => {
  it('内勤の職種を判定する（エンジニア枠は含まない）', () => {
    expect(isBackOffice('sales')).toBe(true);
    expect(isBackOffice('accounting')).toBe(true);
    expect(isBackOffice('network')).toBe(false);
  });

  it('経理の割引は、P に比例して増え、上限で止まる', () => {
    expect(accountingRate(0, balance)).toBe(0);
    expect(accountingRate(5, balance)).toBeCloseTo(0.05, 9);
    expect(accountingRate(1000, balance)).toBe(balance.backOffice.accounting.maxRate);
  });

  it('営業が増やす依頼の数は、上限までの整数', () => {
    expect(salesExtraArrivals(4, balance)).toBe(0);
    expect(salesExtraArrivals(5, balance)).toBe(1);
    expect(salesExtraArrivals(1000, balance)).toBe(balance.backOffice.sales.maxExtra);
  });
});
