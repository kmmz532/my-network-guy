import { describe, expect, it } from 'vitest';
import { balance } from 'virtual:game-data';
import type { Staff } from '../data/schema';
import { createStaff } from './staff';
import { dailyExpOfStaff, devIdleStaffOf } from './staffDaily';

const member = (job: Staff['job']): Staff => ({ ...createStaff({ job, level: 1, salary: 200000 }, 1, 0).staff, desk: 'd' });
const ctx = (overrides = {}) => ({ days: 2, devIdleUids: new Set<string>(), crewUids: new Set<string>(), hasPc: () => true, ...overrides });

describe('日ごとの働き', () => {
  it('営業は PC がなくても経験値を得るが、人事は PC がないと得ない', () => {
    expect(dailyExpOfStaff(member('sales'), ctx({ hasPc: () => false }), balance)).toBe(balance.backOffice.dailyExp * 2);
    expect(dailyExpOfStaff(member('hr'), ctx({ hasPc: () => false }), balance)).toBeNull();
    expect(dailyExpOfStaff(member('hr'), ctx(), balance)).toBe(balance.backOffice.dailyExp * 2);
  });
  it('担当中の現場のエンジニアは自習の経験値を得ない', () => {
    const e = member('network');
    expect(dailyExpOfStaff(e, ctx(), balance)).toBeGreaterThan(0);
    expect(dailyExpOfStaff(e, ctx({ crewUids: new Set([e.uid]) }), balance)).toBeNull();
  });
  it('開発の収入は、担当でなく PC のあるシステムエンジニアだけが得る', () => {
    const dev = member('dev');
    expect(devIdleStaffOf([dev, member('sales')], new Set(), () => true)).toEqual([dev]);
    expect(devIdleStaffOf([dev], new Set([dev.uid]), () => true)).toEqual([]);
    expect(devIdleStaffOf([dev], new Set(), () => false)).toEqual([]);
  });
});
