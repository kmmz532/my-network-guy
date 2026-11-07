// 内勤（営業・人事・経理。担当には出さず、社内の仕事で会社に効果を与える）の効果の計算。純粋な関数。
// 効果の強さは、その職種の内勤（日勤・席の係数と家具の補正を掛けた実効 level）の合計 P で決まる。
import type { Balance, JobId, Staff } from '../data/schema';
import { BACK_OFFICE_JOB_IDS } from '../data/schema';
import type { Office } from './project';
import { furnitureBonus, seatOf, type BonusEnv } from './furniture';

export const isBackOffice = (job: JobId): boolean => (BACK_OFFICE_JOB_IDS as readonly JobId[]).includes(job);

// 内勤の効果に数えるか（日勤で、研修中でない）
export const countsForBackOffice = (s: Staff): boolean => s.shift === 'day' && s.training === null;

// 社員の実効 level（level × 席の係数 × (1 + 家具の補正)）。席がなければ席の係数で下がる
export const effectiveLevelOf = (s: Staff, office: Office, env: BonusEnv): number => {
  const bonus = furnitureBonus(office, s.uid, env);
  const seated = seatOf(office, s.desk, env.defs) !== null;
  const seatFactor = seated ? 1 : bonus.seatless;
  return s.level * seatFactor * (1 + bonus.power);
};

// 社員の机に PC があるか（N102）
export const hasPcAt = (s: Staff, env: BonusEnv): boolean => s.desk !== null && env.pcDesks.includes(s.desk);

// 内勤の効果に数える寄与（N102）。日勤で研修中でないことが前提。
// 人事・経理は PC のある机の社員だけ。営業は PC がなくても数え、PC があると効果が deskPc.salesMultiplier 倍になる
export const backOfficeContributionOf = (s: Staff, office: Office, env: BonusEnv): number => {
  if (!countsForBackOffice(s)) return 0;
  if (s.job === 'sales') return effectiveLevelOf(s, office, env) * (hasPcAt(s, env) ? env.balance.deskPc.salesMultiplier : 1);
  if (s.job === 'hr' || s.job === 'accounting') return hasPcAt(s, env) ? effectiveLevelOf(s, office, env) : 0;
  return 0;
};

// 職種の内勤の実効 level の合計 P（日勤のみ。席がなければ席の係数で下がる。PC の有無も数える・N102）
export const backOfficeP = (staff: readonly Staff[], job: JobId, office: Office, env: BonusEnv): number =>
  staff.reduce((sum, s) => (s.job === job ? sum + backOfficeContributionOf(s, office, env) : sum), 0);

// 経理の割引率（購入の価格を安くする割合。上限 maxRate）
export const accountingRate = (P: number, balance: Balance): number =>
  Math.min(balance.backOffice.accounting.maxRate, P * balance.backOffice.accounting.ratePerLevel);

// 営業の依頼が1日に届く確率（能力が高いほど出やすい。上限 maxChance）
export const salesArrivalChance = (P: number, balance: Balance): number =>
  Math.min(balance.backOffice.sales.maxChance, P * balance.backOffice.sales.chancePerLevel);

// 人事の効果（候補の数を増やす・候補の能力を上げる・研修の経験値の倍率・新人の施工の経験値の倍率）
export const hrCandidateBonus = (P: number, balance: Balance): { extraCount: number; levelBonus: number } => ({
  extraCount: Math.min(balance.backOffice.hr.maxExtraCandidates, Math.floor(P * balance.backOffice.hr.candidatesPerLevel)),
  levelBonus: Math.floor(P * balance.backOffice.hr.candidateLevelPerLevel),
});

export const hrTrainingRate = (P: number, balance: Balance): number =>
  Math.min(balance.backOffice.hr.maxTrainingRate, 1 + P * balance.backOffice.hr.trainingRatePerLevel);

export const hrJuniorRate = (P: number, balance: Balance): number => 1 + P * balance.backOffice.hr.juniorExpRatePerLevel;

// システムエンジニアの開発の率（月給に掛ける）。level が上がるほど上がる
export const devRate = (level: number, balance: Balance): number =>
  balance.backOffice.dev.baseRate + balance.backOffice.dev.ratePerLevel * (level - 1);

// 担当でない日の開発の収入（1日分）。月給 × 率 ÷ 月の日数
export const devDailyIncome = (member: Staff, balance: Balance): number =>
  Math.round((member.salary * devRate(member.level, balance)) / balance.time.daysPerMonth);

// 職種ごとの効果（内勤・システムエンジニア）。加わる社員の寄与 contribution（実効 level）と、加わる前の合計 P から、増える分を出す
export type JobEffect =
  | { kind: 'sales'; chance: number } // 依頼の出やすさの増分（0〜1）
  | { kind: 'hr'; candidates: number; trainingRate: number } // 候補の増分（人）・研修の経験値の倍率の増分
  | { kind: 'accounting'; rate: number } // 割引の割合の増分（0〜1）
  | { kind: 'dev'; monthlyIncome: number }; // 開発の収入（担当でない日の合計・月）

export const jobEffect = (
  job: JobId,
  member: { level: number; salary: number },
  contribution: number,
  P: number,
  balance: Balance,
): JobEffect | null => {
  const after = P + contribution;
  switch (job) {
    case 'sales':
      return { kind: 'sales', chance: salesArrivalChance(after, balance) - salesArrivalChance(P, balance) };
    case 'hr':
      return {
        kind: 'hr',
        candidates: hrCandidateBonus(after, balance).extraCount - hrCandidateBonus(P, balance).extraCount,
        trainingRate: hrTrainingRate(after, balance) - hrTrainingRate(P, balance),
      };
    case 'accounting':
      return { kind: 'accounting', rate: accountingRate(after, balance) - accountingRate(P, balance) };
    case 'dev':
      return { kind: 'dev', monthlyIncome: Math.round(member.salary * devRate(member.level, balance)) };
    default:
      return null;
  }
};
