// 内勤・システムエンジニア・現場のエンジニアの、日ごとの働き（開発の収入の対象と、日ごとの経験値）。純粋な関数。
import type { Balance, Staff } from '../data/schema';
import { isBackOffice } from './backOffice';
import { isDevJob, isFieldEngineerJob, jobOf } from './jobs';

// 開発の収入を得る社員。システムエンジニアで、研修中でなく、担当でなく、机に PC がある社員（N102）
export const devIdleStaffOf = (staff: readonly Staff[], crewUids: ReadonlySet<string>, hasPc: (m: Staff) => boolean): Staff[] =>
  staff.filter((m) => isDevJob(m.job) && m.training === null && !crewUids.has(m.uid) && hasPc(m));

export interface DailyExpContext {
  // 替わった日数
  days: number;
  devIdleUids: ReadonlySet<string>;
  crewUids: ReadonlySet<string>;
  hasPc: (m: Staff) => boolean;
}

// 日ごとの経験値（N102）: 内勤は出勤した日（営業は PC がなくても、人事・経理とシステムエンジニアは PC のある机のみ）。
// 現場のエンジニアは、担当でない日に PC があれば自習で少し。得られない社員は null
export const dailyExpOfStaff = (m: Staff, c: DailyExpContext, balance: Balance): number | null => {
  if (c.devIdleUids.has(m.uid)) return balance.backOffice.dailyExp * c.days;
  if (isBackOffice(m.job)) return m.shift === 'day' && m.training === null && (jobOf(m.job).effect === 'sales' || c.hasPc(m)) ? balance.backOffice.dailyExp * c.days : null;
  if (isFieldEngineerJob(m.job) && m.training === null && !c.crewUids.has(m.uid) && c.hasPc(m)) {
    return balance.backOffice.dailyExp * (jobOf(m.job).pcBonus?.idleExpRate ?? 0) * c.days;
  }
  return null;
};
