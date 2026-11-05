import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import furnitureJson from '../assets/data/furniture.json';
import type { Furniture, Staff } from '../data/schema';
import { emptyOffice } from './project';
import type { BonusEnv } from './furniture';
import { readFileSync } from 'node:fs';
import { NAME_COUNT, QUIRK_IDS, createStaff, gainExp, hintTier, initialStaff, pickName, rollCandidates, specAt, staffPower, staffStatus, totalSalary } from './staff';
import type { Project } from './project';

const balance = balanceJson as unknown as Balance;

describe('新しいゲームの社員', () => {
  it('社員は2人で、職種は network と infra になる', () => {
    const init = initialStaff(balance, 12345);
    expect(init.staff).toHaveLength(2);
    expect(init.staff.map((s) => s.job)).toEqual(['network', 'infra']);
    expect(init.staffSeq).toBe(2);
  });

  it('同じ乱数の状態からは、同じ社員ができる', () => {
    expect(initialStaff(balance, 777)).toEqual(initialStaff(balance, 777));
  });
});

describe('社員を作る', () => {
  it('uid は "s" と連番、経験値・資格・研修は空で始まる', () => {
    const { staff } = createStaff({ job: 'security', level: 2, salary: 150000 }, 42, 5);
    expect(staff).toMatchObject({ uid: 's5', job: 'security', level: 2, salary: 150000, exp: 0, certs: [], training: null });
  });

  it('名前と口癖は言語ファイルの候補の中から選ぶ', () => {
    for (let seed = 1; seed < 200; seed += 7) {
      const { staff } = createStaff({ job: 'network', level: 1, salary: 1 }, seed, 0);
      const n = Number(staff.name.replace('staff.name.', ''));
      expect(Number.isInteger(n) && n >= 0 && n < NAME_COUNT).toBe(true);
      expect(QUIRK_IDS).toContain(staff.quirk);
    }
  });

  it('初期の社員以降は network・level 1・月給 monthlySalary', () => {
    expect(specAt(balance, 2)).toEqual({ job: 'network', level: 1, salary: balance.staff.initial[0].salary });
    expect(specAt(balance, 0)).toEqual({ job: 'network', level: 1, salary: balance.staff.initial[0].salary });
  });
});

describe('施工力', () => {
  const env: BonusEnv = {
    defs: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
    balance,
    staffUids: ['s0'],
  };
  const worker = (level: number, job: Staff['job'] = 'network'): Staff => ({
    uid: 's0',
    name: 'staff.name.0',
    look: 'blue',
    quirk: 'q1',
    job,
    level,
    exp: 0,
    salary: 1,
    certs: [],
    training: null,
  });
  const desk = { uid: 'd', id: 'desk', x: 5, y: 5 };
  const seated = { ...emptyOffice(), furniture: [desk], furnitureSeq: 1 };

  it('職種が一致すると 1.5 倍（席あり・家具なし）', () => {
    expect(staffPower(worker(2), ['network'], seated, env)).toBeCloseTo(3);
  });

  it('職種が一致しなければ係数は 1', () => {
    expect(staffPower(worker(2), ['infra'], seated, env)).toBeCloseTo(2);
    expect(staffPower(worker(2), undefined, seated, env)).toBeCloseTo(2);
  });

  it('席がなければ、席の係数（既定 0.5）を掛ける', () => {
    expect(staffPower(worker(2), undefined, emptyOffice(), env)).toBeCloseTo(1);
  });

  it('席がなくても、ソファがあれば係数は 0.7', () => {
    const office = { ...emptyOffice(), furniture: [{ uid: 'f', id: 'sofa', x: 0, y: 0 }], furnitureSeq: 1 };
    expect(staffPower(worker(2), undefined, office, env)).toBeCloseTo(1.4);
  });

  it('席にいて植物が範囲内なら、家具の施工力 +10% を掛ける', () => {
    const office = { ...emptyOffice(), furniture: [desk, { uid: 'p', id: 'plant', x: 6, y: 5 }], furnitureSeq: 2 };
    expect(staffPower(worker(2), ['network'], office, env)).toBeCloseTo(2 * 1.5 * 1.1);
  });
});

describe('給与と経験値', () => {
  it('給与は全社員の月給の合計', () => {
    const init = initialStaff(balance, 5).staff;
    expect(totalSalary(init)).toBe(init.reduce((sum, s) => sum + s.salary, 0));
  });

  it('経験値が expPerLevel × level に達するとレベルが上がり、余りは繰り越す', () => {
    const staff = { ...initialStaff(balance, 5).staff[0], level: 1, exp: 0 };
    const up = gainExp(staff, 150, balance.staff.expPerLevel);
    expect(up.level).toBe(2);
    expect(up.exp).toBe(50);
  });
});

describe('採用の候補', () => {
  it('候補は0人から maxCandidates 人までの間になる', () => {
    for (let seed = 1; seed < 300; seed += 13) {
      const { candidates } = rollCandidates(0, 1, seed, balance);
      expect(candidates.length).toBeGreaterThanOrEqual(0);
      expect(candidates.length).toBeLessThanOrEqual(balance.hiring.maxCandidates);
    }
  });

  it('level は評判で上がり、月給は level で決まる', () => {
    const h = balance.hiring;
    for (let seed = 1; seed < 200; seed += 7) {
      const { candidates } = rollCandidates(45, 2, seed, balance);
      for (const c of candidates) {
        const base = 1 + Math.floor(45 / h.reputationPerLevel);
        expect([base, base + 1]).toContain(c.level);
        expect(c.salary).toBe(h.baseSalary + h.salaryPerLevel * c.level);
      }
    }
  });

  it('月が変わると、候補の uid の月の部分も変わる', () => {
    const a = rollCandidates(0, 1, 99, balance).candidates;
    const b = rollCandidates(0, 2, 99, balance).candidates;
    expect(a.every((c) => c.uid.startsWith('c1_'))).toBe(true);
    expect(b.every((c) => c.uid.startsWith('c2_'))).toBe(true);
  });
});

describe('ヒントの段階', () => {
  const member = (level: number, job: Staff['job'] = 'network'): Staff => ({ ...initialStaff(balance, 1).staff[0], level, job });
  const levels = balance.staff.hintLevels;

  it('level と hintLevels から段階を求める（1→1、3→2、6→3）', () => {
    expect(hintTier([member(1)], undefined, levels)).toBe(1);
    expect(hintTier([member(3)], undefined, levels)).toBe(2);
    expect(hintTier([member(6)], undefined, levels)).toBe(3);
  });

  it('案件の職種と一致する者の最高 level で決まる。いなければ担当全体の最高 level', () => {
    const crew = [member(6, 'infra'), member(1, 'network')];
    expect(hintTier(crew, ['network'], levels)).toBe(1);
    expect(hintTier(crew, ['security'], levels)).toBe(3);
  });
});

describe('社員の名前が重ならない', () => {
  const spec = { job: 'network' as const, level: 1, salary: 1 };

  it('候補が足りる間は、30人を続けて作っても名前が重ならない', () => {
    let rng = 2024;
    const names: string[] = [];
    for (let i = 0; i < 30; i++) {
      const made = createStaff(spec, rng, i, names);
      rng = made.rng;
      names.push(made.staff.name);
    }
    expect(new Set(names).size).toBe(30);
  });

  it('在籍中の名前は避ける（候補が残っている間）', () => {
    const taken = Array.from({ length: NAME_COUNT - 1 }, (_, i) => `staff.name.${i}`);
    for (let seed = 1; seed < 50; seed++) {
      expect(pickName(seed, taken).name).toBe(`staff.name.${NAME_COUNT - 1}`);
    }
  });

  it('使っていない名前がなくなったときだけ、重なりを許す', () => {
    const all = Array.from({ length: NAME_COUNT }, (_, i) => `staff.name.${i}`);
    expect(all).toContain(pickName(7, all).name);
  });

  it('採用の候補は、在籍中の社員と候補どうしで名前が重ならない', () => {
    const taken = Array.from({ length: 10 }, (_, i) => `staff.name.${i}`);
    for (let seed = 1; seed < 40; seed++) {
      const names = rollCandidates(0, 1, seed, balance, taken).candidates.map((c) => c.name);
      expect(new Set(names).size).toBe(names.length);
      expect(names.some((n) => taken.includes(n))).toBe(false);
    }
  });

  it('名前の候補は言語ファイルに NAME_COUNT 個ある', () => {
    const lang = JSON.parse(readFileSync(new URL('../assets/lang/ja_jp.json', import.meta.url), 'utf8')) as Record<string, string>;
    for (let i = 0; i < NAME_COUNT; i++) expect(lang[`staff.name.${i}`]).toBeTruthy();
    expect(lang[`staff.name.${NAME_COUNT}`]).toBeUndefined();
    expect(new Set(Array.from({ length: NAME_COUNT }, (_, i) => lang[`staff.name.${i}`])).size).toBe(NAME_COUNT);
  });
});

describe('社員の状態', () => {
  const base: Staff = { uid: 's1', name: 'staff.name.0', look: 'blue', quirk: 'q1', job: 'network', level: 1, exp: 0, salary: 1, certs: [], training: null };
  const project = { id: 'p1', baseId: 'c001', params: { n: 2 }, crew: ['s1'] } as unknown as Project;

  it('研修中は残りの日数（1日未満は1日）を出す', () => {
    const staff = { ...base, training: { course: 'basic', untilMinute: 5 * 24 * 60 } };
    expect(staffStatus(staff, [], 0)).toEqual({ kind: 'training', days: 5 });
    expect(staffStatus(staff, [], 5 * 24 * 60 - 1)).toEqual({ kind: 'training', days: 1 });
    expect(staffStatus(staff, [], 2 * 24 * 60 + 1)).toEqual({ kind: 'training', days: 3 });
  });

  it('担当している案件があれば、その案件の名前を出す', () => {
    expect(staffStatus(base, [project], 0)).toEqual({ kind: 'project', baseId: 'c001', params: { n: 2 } });
  });

  it('どちらでもなければ待機中', () => {
    expect(staffStatus(base, [], 0)).toEqual({ kind: 'idle' });
  });
});
