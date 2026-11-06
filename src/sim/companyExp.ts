// 会社の経験値のうち、案件の納品以外の源（N55）。源ごとの量は balance.json の exp、1日の上限は exp.dailyCap
import type { Balance } from '../data/schema';
import { minutesPerDay } from './clock';

// 納品以外の源（案内の段階・採用・部屋の拡張・家具の設置）
export type ExpSource = 'guide' | 'hire' | 'expansion' | 'furniture';

export interface DailyExpState {
  companyExp: number;
  // 経験値を得た日（ゲームの日の番号）と、その日に得た量
  expDay: number;
  expToday: number;
}

export const dayOf = (minute: number): number => Math.floor(minute / minutesPerDay);

// 納品以外の源で経験値を得る。1日の上限を超える分は入らない。得た量を gained で返す
export const grantDailyExp = (
  state: DailyExpState,
  source: ExpSource,
  minute: number,
  balance: Balance,
): DailyExpState & { gained: number } => {
  const day = dayOf(minute);
  const today = state.expDay === day ? state.expToday : 0;
  const gained = Math.max(0, Math.min(balance.exp[source], balance.exp.dailyCap - today));
  return { companyExp: state.companyExp + gained, expDay: day, expToday: today + gained, gained };
};
