// クリア（最後の山場の納品）とエンディング。会社の歩みの札に出す値を、セーブの内容から求める。
import type { Balance, Staff } from '../data/schema';
import type { CompanyRecords } from '../company/company';
import { minutesPerMonth, monthsPerYear } from './clock';

// 最後の山場の固定の依頼。初めて納品するとクリアになる
export const FINAL_CONTRACT_ID = 'z001_final_campus';

// 会社の歩み。創業からの経過（年とか月）・納品した案件の数・★3の数・最も大きな案件・社員の数・最も長く勤めた社員
export interface EndingFacts {
  years: number;
  months: number;
  deliveries: number;
  threeStars: number;
  biggest: CompanyRecords['biggest'];
  staffCount: number;
  longest: { name: string; months: number } | null;
}

export const endingFactsOf = (
  s: { clearedAt: number | null; deliveries: number; records: CompanyRecords; staff: readonly Staff[] },
  balance: Balance,
): EndingFacts => {
  if (s.clearedAt === null) throw new Error('クリアしていない会社の歩みは求められない');
  const monthNow = Math.floor(s.clearedAt / minutesPerMonth(balance));
  const longest = s.staff.reduce<Staff | null>((best, m) => (best === null || m.hiredMonth < best.hiredMonth ? m : best), null);
  return {
    years: Math.floor(monthNow / monthsPerYear),
    months: monthNow % monthsPerYear,
    deliveries: s.deliveries,
    threeStars: s.records.threeStars,
    biggest: s.records.biggest,
    staffCount: s.staff.length,
    longest: longest === null ? null : { name: longest.name, months: monthNow - longest.hiredMonth },
  };
};
