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

// エンディングの流れ。社員が集まる → 会社の歩みの札を1枚ずつ → スタッフロール → 最後の言葉
export type EndingPhase = { kind: 'gather' } | { kind: 'card'; index: number } | { kind: 'credits'; index: number } | { kind: 'last' };

// スタッフロールの見出し（言語ファイルの ui.ending.credit.<見出し>）
export const CREDIT_HEADINGS = ['plan', 'build', 'art'] as const;

// 次の段階。札は factCount 枚、スタッフロールは見出しの数だけ出す。最後の言葉の次はない（null）
export const nextEndingPhase = (phase: EndingPhase, factCount: number): EndingPhase | null => {
  switch (phase.kind) {
    case 'gather':
      return { kind: 'card', index: 0 };
    case 'card':
      return phase.index + 1 < factCount ? { kind: 'card', index: phase.index + 1 } : { kind: 'credits', index: 0 };
    case 'credits':
      return phase.index + 1 < CREDIT_HEADINGS.length ? { kind: 'credits', index: phase.index + 1 } : { kind: 'last' };
    case 'last':
      return null;
  }
};

// スタッフロールを押して飛ばす。最後の言葉へ進む
export const skipCredits = (): EndingPhase => ({ kind: 'last' });

// 段階ごとに自動で進むまでの時間（ms）。最後の言葉は押すまで残す
export const ENDING_MS = { gather: 6000, card: 3000, credits: 2400 } as const;
