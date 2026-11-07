import { describe, expect, it } from 'vitest';
import { balance } from 'virtual:game-data';
import type { Staff } from '../data/schema';
import type { Core, Project } from './project';
import { cancelRetire, noticeRetire, retireBlock, settleRetirements } from './retire';

const member = (uid: string, job: Staff['job'], over: Partial<Staff> = {}): Staff => ({
  uid,
  shift: 'day',
  name: 'staff.name.0',
  look: 'blue_dark_short',
  quirk: 'q1',
  job,
  level: 3,
  exp: 0,
  salary: 200000,
  certs: [],
  training: null,
  hiredMonth: 0,
  leaving: false,
  desk: null,
  ...over,
});

// 社員・案件・時計だけの状態（時計は帳簿なし）
const state = (staff: Staff[], paidMonths = 5, active: { crew: string[] }[] = []): Core =>
  ({
    clock: { minute: 0, money: 1000000, paidMonths, bankrupt: false, ledger: null },
    staff,
    active: active as Project[],
  }) as unknown as Core;

describe('社員の退職（N90）の判定', () => {
  const minMonths = balance.retire.minMonths;

  it('採用から minMonths か月たつまでは伝えられない', () => {
    const staff = [member('s1', 'network', { hiredMonth: 5 }), member('s2', 'network')];
    expect(retireBlock(state(staff, 5 + minMonths - 1), 's1', balance)).toBe('retire.tooSoon');
    expect(retireBlock(state(staff, 5 + minMonths), 's1', balance)).toBeNull();
  });

  it('1か月に1人まで（退職の予定の社員がいれば伝えられない）', () => {
    const staff = [member('s1', 'network', { leaving: true }), member('s2', 'network')];
    expect(retireBlock(state(staff), 's2', balance)).toBe('retire.already');
  });

  it('退職するとエンジニア枠が0人になるなら伝えられない（内勤を辞めさせるのは可）', () => {
    const onlyEngineer = [member('s1', 'network'), member('s2', 'sales')];
    expect(retireBlock(state(onlyEngineer), 's1', balance)).toBe('retire.noEngineer');
    expect(retireBlock(state(onlyEngineer), 's2', balance)).toBeNull();
  });

  it('受注中の案件の担当がこの社員だけなら伝えられない', () => {
    const staff = [member('s1', 'network'), member('s2', 'network')];
    expect(retireBlock(state(staff, 5, [{ crew: ['s1'] }]), 's1', balance)).toBe('retire.soleCrew');
    expect(retireBlock(state(staff, 5, [{ crew: ['s1', 's2'] }]), 's1', balance)).toBeNull();
  });
});

describe('退職の予定の操作', () => {
  it('伝えると退職の予定になり、取り消すと戻る（費用はかからない）', () => {
    const core = state([member('s1', 'network'), member('s2', 'network')]);
    const noticed = noticeRetire(core, 's1', balance);
    expect(noticed.ok).toBe(true);
    if (!noticed.ok) return;
    expect(noticed.core.staff.find((s) => s.uid === 's1')?.leaving).toBe(true);
    const cancelled = cancelRetire(noticed.core, 's1');
    expect(cancelled.ok && cancelled.core.staff.find((s) => s.uid === 's1')?.leaving).toBe(false);
  });

  it('伝えられないときは理由を返し、状態を変えない', () => {
    const core = state([member('s1', 'network', { hiredMonth: 5 })]);
    expect(noticeRetire(core, 's1', balance)).toEqual({ ok: false, reason: 'retire.tooSoon' });
  });
});

describe('月末の処理', () => {
  it('退職金を払い、社員を一覧から外し、担当からも外す', () => {
    const staff = [member('s1', 'network', { leaving: true, salary: 200000 }), member('s2', 'network')];
    const core = state(staff, 5, [{ crew: ['s1', 's2'] }]);
    const settled = settleRetirements(core, balance);
    expect(settled.staff.map((s) => s.uid)).toEqual(['s2']);
    expect(settled.active[0].crew).toEqual(['s2']);
    expect(settled.clock.money).toBe(1000000 - 200000 * balance.retire.payMonths);
  });

  it('退職の予定がなければ、何も変えない', () => {
    const core = state([member('s1', 'network')]);
    expect(settleRetirements(core, balance)).toBe(core);
  });
});
