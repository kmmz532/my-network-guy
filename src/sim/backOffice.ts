// 内勤（営業・人事・経理。担当には出さず、社内の仕事で会社に効果を与える）の効果の計算。純粋な関数。
// 効果の強さは、その職種の内勤（日勤・席の係数と家具の補正を掛けた実効 level）の合計 P で決まる。
import type { Balance, JobId, Staff } from '../data/schema';
import { BACK_OFFICE_JOB_IDS } from '../data/schema';
import type { Office } from './project';
import { furnitureBonus, seatOf, type BonusEnv } from './furniture';

export const isBackOffice = (job: JobId): boolean => (BACK_OFFICE_JOB_IDS as readonly JobId[]).includes(job);

// 職種の内勤の実効 level の合計 P（日勤のみ。席がなければ席の係数で下がる）
export const backOfficeP = (staff: readonly Staff[], job: JobId, office: Office, env: BonusEnv): number =>
  staff.reduce((sum, s) => {
    if (s.job !== job || s.shift !== 'day' || s.training !== null) return sum;
    const bonus = furnitureBonus(office, s.uid, env);
    const seated = seatOf(office, env.staffUids, s.uid, env.defs) !== null;
    const seatFactor = seated ? 1 : bonus.seatless;
    return sum + s.level * seatFactor * (1 + bonus.power);
  }, 0);

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
