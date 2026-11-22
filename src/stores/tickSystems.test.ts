// 毎ティックの系: 状態と TickEnv だけから結果が決まること（時刻と設定を内部で読まないこと）
import { beforeEach, describe, expect, it } from 'vitest';
import balanceJson from '../../resources/data/balance.json';
import type { Balance } from '../data/schema';
import { minutesPerDay, minutesPerMonth } from '../sim/clock';
import { expAmountOf } from '../sim/level';
import type { Staff } from '../data/schema';
import { nightSpeedSystem, payPauseSystem, runTick } from './tickSystems';
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
    expect(payPauseSystem(st(), { now: 1, payPause: false, nightFast: false })).toBeNull();
    expect(payPauseSystem(st(), { now: 1, payPause: true, nightFast: false })?.speed).toBe(0);
  });

  it('通知の時刻は引数の now で決まり、同じ入力は同じ結果になる', () => {
    const env = { now: 123456, payPause: true, nightFast: false };
    const a = runTick(st(), env);
    const b = runTick(st(), env);
    expect(a).toEqual(b);
    expect(a.notices?.[0]?.shownAt).toBe(123456);
  });

  it('状態を書き換えない', () => {
    const before = st();
    const snapshot = JSON.stringify({ clock: before.clock, speed: before.speed, notices: before.notices });
    runTick(before, { now: 1, payPause: false, nightFast: false });
    expect(JSON.stringify({ clock: st().clock, speed: st().speed, notices: st().notices })).toBe(snapshot);
  });

  it('納品の結果を開いている間は何も変えない', () => {
    useGameStore.setState({ showcase: { nodes: [], links: [], plans: {}, contract: { map: 'hq' } } as never });
    expect(runTick(st(), { now: 1, payPause: false, nightFast: false })).toEqual({});
  });
});

// 日が替わる直前の時計（次のティックで日が替わる）
const dayEnd = { minute: minutesPerDay - balance.time.gameMinutesPerTick, money: 10_000_000, paidMonths: 0, bankrupt: false, ledger: [] };
const worker: Staff = {
  shift: 'day',
  uid: 's0',
  name: 'staff.name.0',
  look: 'blue',
  quirk: 'q1',
  job: 'network',
  level: 1,
  exp: 0,
  salary: 200000,
  certs: [],
  training: null,
  hiredMonth: 0,
  leaving: false,
  desk: null,
  levelCap: 10,
};
const env = { now: 1, payPause: false, nightFast: false };

describe('勤務日の運営の経験値（xp.dailyOps）', () => {
  beforeEach(nearPayday);
  it('社員がいる日が替わると、量を得る', () => {
    useGameStore.setState({ companyExp: 0, staff: [worker], clock: dayEnd });
    expect(runTick(st(), env).companyExp).toBe(expAmountOf(balance.xp.dailyOps, 1, balance));
  });
  it('社員がいない日（休日）には足さない', () => {
    useGameStore.setState({ companyExp: 0, staff: [], clock: dayEnd });
    expect(runTick(st(), env).companyExp).toBeUndefined();
  });
  it('日が替わらないティックでは足さない', () => {
    useGameStore.setState({ companyExp: 0, staff: [worker], clock: { ...dayEnd, minute: 600 } });
    expect(runTick(st(), env).companyExp).toBeUndefined();
  });
});

describe('夜の自動の早送り', () => {
  it('夜勤の社員がいても、序盤でも、夜は balance の夜の速さで進める', () => {
    const night = { ...st().clock, minute: 23 * 60 };
    const staff = st().staff.map((m) => ({ ...m, shift: 'night' as const }));
    useGameStore.setState({ speed: 1, nightSpeed: null, companyExp: 0, staff, active: [] });
    const out = nightSpeedSystem(st(), {}, night, { now: 0, payPause: false, nightFast: true });
    expect(out.speed).toBe(balance.time.nightSpeed);
    expect(out.nightSpeed).toBe(1);
  });
});
