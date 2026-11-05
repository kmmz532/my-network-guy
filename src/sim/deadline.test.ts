import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { minutesPerDay } from './clock';
import { dueDayOf, lateDaysOf, lateFactor } from './deadline';

const balance = balanceJson as unknown as Balance;
const day = (n: number) => n * minutesPerDay;

describe('期日', () => {
  it('受注日からの日数で期日を決める', () => {
    expect(dueDayOf(day(2), 3)).toBe(5);
    expect(dueDayOf(day(2) + 100, 3)).toBe(5);
  });

  it('期日のない案件は期日を決めない', () => {
    expect(dueDayOf(day(2), undefined)).toBeNull();
    expect(lateDaysOf(null, day(99))).toBe(0);
  });
});

describe('納品の報酬', () => {
  const due = 5;

  it('期日内（期日の日を含む）は報酬が減らない', () => {
    expect(lateFactor(lateDaysOf(due, day(4)), balance)).toBe(1);
    expect(lateFactor(lateDaysOf(due, day(5)), balance)).toBe(1);
  });

  it('3日遅れは70%', () => {
    expect(lateFactor(lateDaysOf(due, day(8)), balance)).toBeCloseTo(0.7);
  });

  it('10日遅れは最低の50%', () => {
    expect(lateFactor(lateDaysOf(due, day(15)), balance)).toBe(0.5);
  });
});
