// 職種の定義（N104）: jobs.json が今の職種・解放・係数と一致すること（分岐を置き換えるまでの間の安全確認）
import { describe, expect, it } from 'vitest';
import { BACK_OFFICE_JOB_IDS, ENGINEER_JOB_IDS, JOB_IDS } from '../data/schema';
import { JOB_DEFS, jobOf } from './jobs';


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

  it('定義にない職種を引くと例外（R5）', () => {
    expect(() => jobOf('nope')).toThrow();
    expect(jobOf('dev').group).toBe('dev');
  });
});
