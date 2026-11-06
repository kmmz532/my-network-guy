// 内勤の効果（職種・割引率・営業の依頼の数）
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { accountingRate, devDailyIncome, devRate, hrCandidateBonus, hrJuniorRate, hrTrainingRate, isBackOffice, salesArrivalChance } from './backOffice';
import type { Staff } from '../data/schema';

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

  it('営業の依頼が1日に届く確率は、能力に応じて上がり、上限で止まる', () => {
    expect(salesArrivalChance(0, balance)).toBe(0);
    expect(salesArrivalChance(3, balance)).toBeGreaterThan(salesArrivalChance(1, balance));
    expect(salesArrivalChance(1000, balance)).toBe(balance.backOffice.sales.maxChance);
  });
});

describe('人事の効果', () => {
  it('候補は、人数と能力が P に応じて増える（人数は上限まで）', () => {
    expect(hrCandidateBonus(0, balance)).toEqual({ extraCount: 0, levelBonus: 0 });
    expect(hrCandidateBonus(5, balance)).toEqual({ extraCount: 1, levelBonus: 1 });
    expect(hrCandidateBonus(1000, balance).extraCount).toBe(balance.backOffice.hr.maxExtraCandidates);
  });

  it('研修と新人の倍率は、上限までの 1 以上の値', () => {
    expect(hrTrainingRate(0, balance)).toBe(1);
    expect(hrTrainingRate(10, balance)).toBeGreaterThan(1);
    expect(hrTrainingRate(1000, balance)).toBe(balance.backOffice.hr.maxTrainingRate);
    expect(hrJuniorRate(0, balance)).toBe(1);
    expect(hrJuniorRate(10, balance)).toBeGreaterThan(1);
  });
});

describe('システムエンジニアの開発の収入', () => {
  it('率は level で上がり、採用直後（level 1）は月給と同じ額（1日分に割る）', () => {
    expect(devRate(1, balance)).toBeCloseTo(balance.backOffice.dev.baseRate, 9);
    expect(devRate(10, balance)).toBeGreaterThan(devRate(1, balance));
    const member = { salary: 300000, level: 1 } as Staff;
    expect(devDailyIncome(member, balance) * balance.time.daysPerMonth).toBeCloseTo(300000, -2);
  });
});
