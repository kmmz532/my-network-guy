// 研修と資格（STAFF.md「4. 育成」）。受講と受験の判定は純粋関数で行う。
// 研修中・担当中の社員は受講できず、受験もできない。研修は期日に経験値を与え、受験に合格すると資格を得て level が1上がる。
import { applyMoney } from './ledger';
import type { Balance, CertDef, TrainingCourse } from '../data/schema';
import { minutesPerDay } from './clock';
import type { Core, Outcome } from './project';
import { gainExp } from './staff';

export interface TrainingEnv {
  courses: Record<string, TrainingCourse>;
  certs: Record<string, CertDef>;
  balance: Balance;
}

const fail = (reason: string): Outcome => ({ ok: false, reason });

// 担当の社員（案件を受注中の社員）の uid
const crewOf = (core: Core): Set<string> => new Set(core.active.flatMap((p) => p.crew));

// 試験の合格率: min(maxRate, baseRate + perLevel × (level − minLevel))
export const examPassRate = (level: number, minLevel: number, balance: Balance): number =>
  Math.min(balance.exam.maxRate, balance.exam.baseRate + balance.exam.perLevel * (level - minLevel));

// 研修を受けさせる。費用を払い、期日を記録する
export const startTraining = (core: Core, uid: string, courseId: string, env: TrainingEnv): Outcome => {
  const member = core.staff.find((s) => s.uid === uid);
  if (!member) return fail('none');
  const course = env.courses[courseId];
  if (!course) return fail('none');
  if (member.training) return fail('training');
  if (crewOf(core).has(uid)) return fail('crew');
  if (core.clock.money < course.cost) return fail('money');
  const untilMinute = core.clock.minute + course.days * minutesPerDay;
  const staff = core.staff.map((s) => (s.uid === uid ? { ...s, training: { course: courseId, untilMinute } } : s));
  return { ok: true, core: { ...core, staff, clock: applyMoney(core.clock, -course.cost, 'training') } };
};

// 期日を過ぎた研修を終える。受講した社員に、課程の経験値を与える
// rate は人事の効果（研修の経験値の倍率。既定は1）
export const finishTrainings = (core: Core, env: TrainingEnv, rate = 1): Core => {
  let changed = false;
  const staff = core.staff.map((s) => {
    if (!s.training || s.training.untilMinute > core.clock.minute) return s;
    changed = true;
    const exp = env.courses[s.training.course]?.exp ?? 0;
    return { ...gainExp(s, exp * rate, env.balance.staff.expPerLevel), training: null };
  });
  return changed ? { ...core, staff } : core;
};

// 資格の受験。roll（0以上1未満）が合格率を下回れば合格し、資格を得て level が1上がる。受験料は合否によらずかかる
export const takeExam = (core: Core, uid: string, certId: string, roll: number, env: TrainingEnv): Outcome => {
  const member = core.staff.find((s) => s.uid === uid);
  const cert = env.certs[certId];
  if (!member || !cert) return fail('none');
  if (member.job !== cert.job) return fail('job');
  if (member.level < cert.minLevel) return fail('level');
  if (member.training) return fail('training');
  if (member.certs.includes(certId)) return fail('owned');
  if (crewOf(core).has(uid)) return fail('crew');
  if (core.clock.money < cert.fee) return fail('money');
  const paid: Core = { ...core, clock: applyMoney(core.clock, -cert.fee, 'exam') };
  if (roll >= examPassRate(member.level, cert.minLevel, env.balance)) return { ok: true, core: paid };
  const staff = core.staff.map((s) => (s.uid === uid ? { ...s, certs: [...s.certs, certId], level: s.level + 1 } : s));
  return { ok: true, core: { ...paid, staff } };
};
