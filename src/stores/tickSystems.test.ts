// 毎ティックの系: 状態と TickEnv だけから結果が決まること（時刻と設定を内部で読まないこと）
import { beforeEach, describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { minutesPerMonth } from '../sim/clock';
import { payPauseSystem, runTick } from './tickSystems';
import { useGameStore } from './useGameStore';

const balance = balanceJson as unknown as Balance;
const st = () => useGameStore.getState();

const nearPayday = () =>
  useGameStore.setState({
    speed: 1,
    payWarned: null,
    showcase: null,
    notices: [],
    clock: { minute: minutesPerMonth(balance) - balance.time.gameMinutesPerTick, money: 0, paidMonths: 0, bankrupt: false, ledger: [] },
  });

describe('毎ティックの系', () => {
  beforeEach(nearPayday);

  it('給与の一時停止は、引数の設定がオフなら働かない', () => {
    expect(payPauseSystem(st(), { now: 1, payPause: false })).toBeNull();
    expect(payPauseSystem(st(), { now: 1, payPause: true })?.speed).toBe(0);
  });

  it('通知の時刻は引数の now で決まり、同じ入力は同じ結果になる', () => {
    const env = { now: 123456, payPause: true };
    const a = runTick(st(), env);
    const b = runTick(st(), env);
    expect(a).toEqual(b);
    expect(a.notices?.[0]?.shownAt).toBe(123456);
  });

  it('状態を書き換えない', () => {
    const before = st();
    const snapshot = JSON.stringify({ clock: before.clock, speed: before.speed, notices: before.notices });
    runTick(before, { now: 1, payPause: false });
    expect(JSON.stringify({ clock: st().clock, speed: st().speed, notices: st().notices })).toBe(snapshot);
  });

  it('納品の結果を開いている間は何も変えない', () => {
    useGameStore.setState({ showcase: { nodes: [], links: [], plans: {}, contract: { map: 'hq' } } as never });
    expect(runTick(st(), { now: 1, payPause: false })).toEqual({});
  });
});
