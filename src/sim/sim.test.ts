import { describe, expect, it } from 'vitest';
import type { Balance } from '../data/schema';
import { advanceTick, initialClock, minutesPerMonth, toDate } from './clock';
import { rate } from './rating';

const balance = {
  time: { realMsPerTick: 1000, gameMinutesPerTick: 60, daysPerMonth: 30, speeds: [0, 1, 2, 4] },
  startMoney: 1000,
  offerIntervalDays: 3,
  staff: { initialCount: 2, monthlySalary: 200 },
  build: { workStartHour: 9, workEndHour: 18, minutesPerDevice: 240, minutesPerCableTile: 15 },
  rating: [
    { stars: 3, maxCostRatio: 0.8, maxRework: 0 },
    { stars: 2, maxCostRatio: 1.0, maxRework: 1 },
    { stars: 1, maxCostRatio: null, maxRework: null },
  ],
  reputationPerStar: 1,
} as Balance;

describe('clock', () => {
  it('1 Tick で60分進み、1か月ごとに給与を払う', () => {
    let state = initialClock(balance);
    const ticksPerMonth = minutesPerMonth(balance) / 60;
    for (let i = 0; i < ticksPerMonth; i++) state = advanceTick(state, balance, 2);
    expect(state.minute).toBe(minutesPerMonth(balance));
    expect(state.paidMonths).toBe(1);
    expect(state.money).toBe(1000 - 2 * 200);
  });

  it('月末に資金が0円未満なら倒産し、以後は進まない', () => {
    let state = { ...initialClock(balance), money: 100 };
    const ticksPerMonth = minutesPerMonth(balance) / 60;
    for (let i = 0; i < ticksPerMonth; i++) state = advanceTick(state, balance, 2);
    expect(state.bankrupt).toBe(true);
    const frozen = advanceTick(state, balance, 2);
    expect(frozen).toBe(state);
  });

  it('ゲーム内の日時を求める', () => {
    expect(toDate(60 * 25, balance)).toEqual({ month: 1, day: 2, hour: 1 });
  });
});

describe('rating', () => {
  it('費用の割合と手戻りで★を決める', () => {
    expect(rate(70, 100, 0, balance)).toBe(3);
    expect(rate(90, 100, 0, balance)).toBe(2);
    expect(rate(90, 100, 2, balance)).toBe(1);
    expect(rate(150, 100, 0, balance)).toBe(1);
  });
});
