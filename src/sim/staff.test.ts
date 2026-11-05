import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { NAME_COUNT, QUIRK_IDS, createStaff, initialStaff, specAt } from './staff';

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
    expect(specAt(balance, 2)).toEqual({ job: 'network', level: 1, salary: balance.staff.monthlySalary });
    expect(specAt(balance, 0)).toEqual({ job: 'network', level: 1, salary: balance.staff.initial[0].salary });
  });
});
