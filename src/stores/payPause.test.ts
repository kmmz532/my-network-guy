// 給与を払えない月の対策: 給与の直前に一度だけ時間を止め、再開したら止めずに払う
import { beforeEach, describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { minutesPerMonth } from '../sim/clock';
import { useGameStore } from './useGameStore';

const balance = balanceJson as unknown as Balance;
const st = () => useGameStore.getState();

// 給与の1Tick前（次のTickで給与の日に入る）に、資金を給与より少なくして置く
const nearPayday = () => {
  const payday = minutesPerMonth(balance);
  useGameStore.setState({
    speed: 1,
    payWarned: null,
    clock: { minute: payday - balance.time.gameMinutesPerTick, money: 0, paidMonths: 0, bankrupt: false, ledger: [] },
  });
};

describe('給与を払えない月の対策', () => {
  beforeEach(() => {
    nearPayday();
  });

  it('給与の直前に一度止まり、時間は進まず、知らせを出す', () => {
    const before = st().clock.minute;
    st().tick();
    expect(st().speed).toBe(0);
    expect(st().clock.minute).toBe(before);
    expect(st().clock.paidMonths).toBe(0);
    expect(st().notices.map((n) => n.kind)).toContain('payPause');
    expect(st().payWarned).toBe(0);
  });

  it('再開したら、同じ月はもう止めずに給与を払う', () => {
    st().tick();
    useGameStore.setState({ speed: 1 });
    st().tick();
    expect(st().speed).toBe(1);
    expect(st().clock.paidMonths).toBe(1);
    expect(st().clock.bankrupt).toBe(true);
  });

  it('資金が足りている月は止めない', () => {
    useGameStore.setState({ clock: { ...st().clock, money: 10_000_000 } });
    st().tick();
    expect(st().speed).toBe(1);
    expect(st().clock.paidMonths).toBe(1);
  });
});
