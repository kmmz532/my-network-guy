// 案件の担当に社員を選べるかの判定（N117）。受注・担当の一覧・担当の初期値・受注の画面は、この判定だけを使う。
import type { Staff } from '../data/schema';
import type { Core } from './project';
import { isBackOffice } from './backOffice';

// 担当中の社員（いずれかの案件の担当）の uid
// 担当中の集合を作る関数はここだけ（ほかで flatMap して作らない・N117）
// eslint-disable-next-line no-restricted-syntax -- 定義の場所
export const busyStaff = (core: Pick<Core, 'active'>): Set<string> => new Set(core.active.flatMap((p) => p.crew));

// 担当に選べない理由（選べるなら null）。内勤（営業・人事・経理）、研修中、退職の予定（月末まで受注済みの案件を続ける・N90）、ほかの案件の担当
export type CrewBlock = 'backOffice' | 'training' | 'leaving' | 'busy';

export const crewBlock = (core: Pick<Core, 'active'>, member: Staff): CrewBlock | null => {
  if (isBackOffice(member.job)) return 'backOffice';
  if (member.training !== null) return 'training';
  if (member.leaving) return 'leaving';
  if (busyStaff(core).has(member.uid)) return 'busy';
  return null;
};
