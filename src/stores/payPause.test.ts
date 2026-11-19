// 給与を払えない月の対策: 給与の直前に一度だけ時間を止め、再開したら止めずに払う
import { beforeEach, describe, expect, it, vi } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { minutesPerMonth } from '../sim/clock';
import { saveSettings } from '../settings/settings';
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
    // 給与の日は夜のことが多い。夜の自動の早送りで速さが変わらないよう、この試験では切っておく（端末の設定は記憶の上に置く）
    const mem = new Map<string, string>();
    vi.stubGlobal('window', { localStorage: { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) } });
    saveSettings({ nightFast: false });
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
