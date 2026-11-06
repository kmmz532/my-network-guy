// 会社の経験値のうち、案件の納品以外の源（N55）。量は、現在のレベルの必要経験値に balance.json の exp の割合を掛けた値
import type { Balance } from '../data/schema';
import { minutesPerDay } from './clock';
import { dailyExpCapOf, expAmountOf, levelOf } from './level';

// 納品以外の源（案内の段階・採用・部屋の拡張・家具の設置）
export type ExpSource = 'guide' | 'hire' | 'expansion' | 'furniture';

export interface DailyExpState {
  companyExp: number;
  // 経験値を得た日（ゲームの日の番号）と、その日に得た量
  expDay: number;
  expToday: number;
}

export const dayOf = (minute: number): number => Math.floor(minute / minutesPerDay);

// 納品以外の源で経験値を得る。繰り返せる源は1日の上限（dailyExpCapOf）まで。案内の段階（各1回）は上限の対象外。得た量を gained で返す
export const grantDailyExp = (
  state: DailyExpState,
  source: ExpSource,
  minute: number,
  balance: Balance,
): DailyExpState & { gained: number } => {
  const level = levelOf(state.companyExp, balance);
  const day = dayOf(minute);
  const today = state.expDay === day ? state.expToday : 0;
  const amount = expAmountOf(balance.exp[source], level, balance);
  const room = source === 'guide' ? Infinity : dailyExpCapOf(level, balance) - today;
  const gained = Math.max(0, Math.min(amount, room));
  return { companyExp: state.companyExp + gained, expDay: day, expToday: today + gained, gained };
};
