// 帳簿（お金の増減を月ごと・分類ごとに記録する）
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { advanceTick, initialClock, minutesPerMonth, type ClockState } from './clock';
import { applyMoney, LEDGER_MONTHS } from './ledger';

const balance = balanceJson as unknown as Balance;
const monthLength = minutesPerMonth(balance);
const clockAt = (month: number, extra: Partial<ClockState> = {}): ClockState => ({
  ...initialClock(balance),
  minute: month * monthLength,
  ledger: [],
  ...extra,
});

describe('帳簿', () => {
  it('お金の増減を、今月の分類の合計に記録し、資金も変える', () => {
    let c = clockAt(0);
    c = applyMoney(c, 5000, 'reward');
    c = applyMoney(c, -2000, 'purchase');
    expect(c.money).toBe(balance.startMoney + 3000);
    expect(c.ledger).toEqual([{ month: 0, totals: expect.objectContaining({ reward: 5000, purchase: -2000 }) }]);
  });

  it('月が変わると、別の月の合計になる', () => {
    let c = applyMoney(clockAt(0), 100, 'sale');
    c = applyMoney({ ...c, minute: monthLength }, 200, 'sale');
    expect(c.ledger?.map((m) => [m.month, m.totals.sale])).toEqual([
      [0, 100],
      [1, 200],
    ]);
  });

  it('直近の LEDGER_MONTHS か月だけ残す', () => {
    let c = clockAt(0);
    for (let m = 0; m < LEDGER_MONTHS + 3; m++) c = applyMoney({ ...c, minute: m * monthLength }, 1, 'reward');
    expect(c.ledger?.length).toBe(LEDGER_MONTHS);
    expect(c.ledger?.[0].month).toBe(3);
  });

  it('サンドボックス（帳簿なし）では、お金だけ変わり記録はしない', () => {
    const c = applyMoney({ ...clockAt(0), ledger: null }, -500, 'purchase');
    expect(c.money).toBe(balance.startMoney - 500);
    expect(c.ledger).toBeNull();
  });

  it('給与は月の区切りで払われ、給与の分類に記録される', () => {
    const start = clockAt(0, { minute: monthLength - balance.time.gameMinutesPerTick });
    const next = advanceTick(start, balance, 10000);
    expect(next.paidMonths).toBe(1);
    expect(next.money).toBe(balance.startMoney - 10000);
    expect(next.ledger?.[0].totals.salary).toBe(-10000);
  });
});
