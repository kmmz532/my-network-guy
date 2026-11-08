// 内勤の効果（職種・割引率・営業の依頼の数）
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { printerArrivalBonusOf, accountingRate, backOfficeP, devDailyIncome, devRate, hrCandidateBonus, hrJuniorRate, hrTrainingRate, isBackOffice, jobEffect, salesArrivalChance } from './backOffice';
import furnitureJson from '../assets/data/furniture.json';
import type { BonusEnv } from './furniture';
import type { Furniture } from '../data/schema';
import type { Office } from './project';
import { staffPower } from './staff';
import type { Staff } from '../data/schema';
import { jobOf } from './jobs';

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

describe('職種ごとの効果（札と社員の詳細に出す増分）', () => {
  const who = { level: 3, salary: 200000 };

  it('営業は、加わった分だけ依頼の出やすさが増える（上限まで）', () => {
    const e = jobEffect('sales', who, 3, 0, balance);
    expect(e).toEqual({ kind: 'sales', chance: salesArrivalChance(3, balance) });
  });

  it('経理は、加わった分だけ割引の割合が増える', () => {
    const e = jobEffect('accounting', who, 3, 2, balance);
    expect(e).toEqual({ kind: 'accounting', rate: accountingRate(5, balance) - accountingRate(2, balance) });
  });

  it('人事は、候補の増分と研修の倍率の増分を出す', () => {
    const e = jobEffect('hr', who, 5, 0, balance);
    expect(e).toEqual({
      kind: 'hr',
      candidates: hrCandidateBonus(5, balance).extraCount,
      trainingRate: hrTrainingRate(5, balance) - hrTrainingRate(0, balance),
    });
  });

  it('システムエンジニアは、開発の収入を月ぶんで出す（担当でない日の合計）', () => {
    const e = jobEffect('dev', who, 3, 0, balance);
    expect(e).toEqual({ kind: 'dev', monthlyIncome: Math.round(who.salary * devRate(who.level, balance)) });
  });

  it('エンジニア枠（内勤でない職種）には効果を出さない', () => {
    expect(jobEffect('network', who, 3, 0, balance)).toBeNull();
  });
});

describe('机の上の PC（N102）', () => {
  // 机（家具 desk）の上に PC があるかどうかだけを変える
  const office = { size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [{ uid: 'd0', id: 'desk', x: 2, y: 2 }], furnitureSeq: 1 } as unknown as Office;
  const member = (job: Staff['job'], desk: string | null): Staff => ({
    uid: 's0', shift: 'day', name: 'staff.name.0', look: 'blue', quirk: 'q1', job, level: 4, exp: 0, salary: 1,
    certs: [], training: null, hiredMonth: 0, leaving: false, desk, levelCap: 10,
  });
  const envWith = (pcDesks: string[]): BonusEnv => ({
    defs: Object.fromEntries((furnitureJson.furniture as unknown as Furniture[]).map((f) => [f.id, f])),
    balance,
    staff: [{ uid: 's0', desk: 'd0' }],
    pcDesks,
  });

  it('人事・経理は、PC のない机の社員は効果に数えない', () => {
    expect(backOfficeP([member('hr', 'd0')], 'hr', office, envWith([]))).toBe(0);
    expect(backOfficeP([member('accounting', 'd0')], 'accounting', office, envWith([]))).toBe(0);
  });

  it('人事・経理は、PC のある机なら効果に数える', () => {
    expect(backOfficeP([member('hr', 'd0')], 'hr', office, envWith(['d0']))).toBeGreaterThan(0);
  });

  it('営業は、PC がなくても数え、PC があると職種定義の係数で効果が上がる', () => {
    const without = backOfficeP([member('sales', 'd0')], 'sales', office, envWith([]));
    const withPc = backOfficeP([member('sales', 'd0')], 'sales', office, envWith(['d0']));
    expect(without).toBeGreaterThan(0);
    expect(withPc).toBeCloseTo(without * (jobOf('sales').pcBonus?.effectRate ?? 1));
  });

  it('机のない社員は、PC があっても人事・経理に数えない', () => {
    expect(backOfficeP([member('hr', null)], 'hr', office, envWith(['d0']))).toBe(0);
  });

  it('現場のエンジニアは、PC があると施工力が上がる（システムエンジニアは上がらない）', () => {
    const base = staffPower(member('network', 'd0'), undefined, office, envWith([]));
    const pc = staffPower(member('network', 'd0'), undefined, office, envWith(['d0']));
    expect(pc).toBeCloseTo(base * (1 + (jobOf('network').pcBonus?.buildRate ?? 0)));
    const dev = staffPower(member('dev', 'd0'), undefined, office, envWith(['d0']));
    expect(dev).toBeCloseTo(staffPower(member('dev', 'd0'), undefined, office, envWith([])));
  });
});

describe('プリンターの効果（N98）', () => {
  const printer = (uid: string, x: number, y: number) => ({ uid, device: 'printer_basic', x, y, hostname: '', macSerial: 1 });
  const link = (a: string, b: string) => ({ uid: `l_${a}_${b}`, cable: 'utp', a: { node: a, port: 0 }, b: { node: b, port: 0 }, path: [] });
  const isPrinter = (d: string) => d === 'printer_basic';
  const office = (nodes: unknown[], links: unknown[]) => ({ size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes, links, seq: 0, furniture: [], furnitureSeq: 0 }) as unknown as Office;

  it('つないでいないプリンターは効かない', () => {
    expect(printerArrivalBonusOf(office([printer('p1', 1, 1)], []), isPrinter, balance)).toBe(0);
  });

  it('つないでいるプリンターがあれば効く（台数は数えない）', () => {
    const one = printerArrivalBonusOf(office([printer('p1', 1, 1), { ...printer('p2', 2, 1), device: 'pc_basic' }], [link('p1', 'p2')]), isPrinter, balance);
    const two = printerArrivalBonusOf(office([printer('p1', 1, 1), printer('p3', 3, 1), { ...printer('p2', 2, 1), device: 'pc_basic' }], [link('p1', 'p2'), link('p3', 'p2')]), isPrinter, balance);
    expect(one).toBe(balance.backOffice.sales.printerArrivalBonus);
    expect(two).toBe(one);
  });
});
