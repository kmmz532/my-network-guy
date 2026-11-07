import { describe, expect, it } from 'vitest';
import type { Staff } from '../data/schema';
import type { Project } from './project';
import { busyStaff, crewBlock } from './crew';

// 試験用の社員（判定に使う欄だけ）
const member = (uid: string, extra: Partial<Staff> = {}): Staff => ({ uid, job: 'dev', training: null, leaving: false, ...extra } as unknown as Staff);
const project = (crew: string[]): Pick<Project, 'crew'> => ({ crew });

describe('担当の判定（crewBlock）', () => {
  it('空いている社員は選べる（null）', () => {
    expect(crewBlock({ active: [] as Project[] }, member('a'))).toBeNull();
  });

  it('ほかの案件の担当・研修中・退職の予定・内勤は、理由を返す', () => {
    const core = { active: [project(['a'])] as Project[] };
    expect(crewBlock(core, member('a'))).toBe('busy');
    expect(crewBlock({ active: [] as Project[] }, member('b', { training: {} as Staff['training'] }))).toBe('training');
    expect(crewBlock({ active: [] as Project[] }, member('c', { leaving: true }))).toBe('leaving');
    expect(crewBlock({ active: [] as Project[] }, member('d', { job: 'sales' }))).toBe('backOffice');
  });

  it('担当中の社員の集合は、案件の担当の和', () => {
    expect([...busyStaff({ active: [project(['a', 'b']), project(['c'])] as Project[] })].sort()).toEqual(['a', 'b', 'c']);
  });
});
