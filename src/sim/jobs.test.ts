// 職種の定義（N104）: jobs.json が今の職種・解放・係数と一致すること（分岐を置き換えるまでの間の安全確認）
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { BACK_OFFICE_JOB_IDS, ENGINEER_JOB_IDS, JOB_IDS } from '../data/schema';
import { JOB_DEFS, jobOf } from './jobs';

const balance = balanceJson as unknown as Balance;

describe('職種の定義（jobs.json・N104）', () => {
  it('職種の ID は、今の職種と過不足なく一致する', () => {
    expect([...JOB_DEFS.map((j) => j.id)].sort()).toEqual([...JOB_IDS].sort());
  });

  it('区分（エンジニア枠・内勤）は今のものと一致する', () => {
    for (const j of JOB_DEFS) {
      if (j.group === 'backOffice') expect(BACK_OFFICE_JOB_IDS).toContain(j.id);
      else expect(ENGINEER_JOB_IDS).toContain(j.id);
    }
  });

  it('解放のレベルは、balance.json の hiring.jobUnlockLevels と一致する', () => {
    for (const j of JOB_DEFS) expect(j.unlockLevel).toBe(balance.hiring.jobUnlockLevels[j.id as keyof typeof balance.hiring.jobUnlockLevels]);
  });

  it('給与の係数は、内勤だけ backOfficeSalaryRate（N100）', () => {
    for (const j of JOB_DEFS) {
      expect(j.salaryRate).toBe(j.group === 'backOffice' ? balance.hiring.backOfficeSalaryRate : 1);
    }
  });

  it('PC の効果の大きさは、balance.json の deskPc と一致する（N102）', () => {
    for (const j of JOB_DEFS) {
      if (j.group === 'field') {
        expect(j.pcBonus?.buildRate).toBe(balance.deskPc.engineerPowerBonus);
        expect(j.pcBonus?.idleExpRate).toBe(balance.deskPc.engineerDailyExpRate);
      }
      if (j.id === 'sales') expect(j.pcBonus?.effectRate).toBe(balance.deskPc.salesMultiplier);
    }
  });

  it('定義にない職種を引くと例外（R5）', () => {
    expect(() => jobOf('nope')).toThrow();
    expect(jobOf('dev').group).toBe('dev');
  });
});
