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

// 営業が増やす依頼の数（1日あたり。上限 maxExtra）
export const salesExtraArrivals = (P: number, balance: Balance): number =>
  Math.min(balance.backOffice.sales.maxExtra, Math.floor(P * balance.backOffice.sales.arrivalsPerLevel));
