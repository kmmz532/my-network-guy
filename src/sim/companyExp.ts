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

// 勤務日の運営の経験値（xp.dailyOps）。日が替わった回数（days）ぶん、現在のレベルの必要経験値に割合を掛けて足す。繰り返せる源の上限（dailyCap）には数えない
export const dailyOpsGainOf = (companyExp: number, days: number, balance: Balance): number =>
  days <= 0 ? 0 : days * expAmountOf(balance.xp.dailyOps, levelOf(companyExp, balance), balance);

// 達成条件の型を初めて合格させた納品の経験値（xp.firstGoal）。done は今までに合格させた型、goalTypes は今回の案件の達成条件の型。
// 型ごとに1回だけ数え、新しく合格させた型の一覧（types）と、得た量（gained）を返す
export const firstGoalGainOf = (done: readonly string[], goalTypes: readonly string[], companyExp: number, balance: Balance): { types: string[]; gained: number } => {
  const types = [...new Set(goalTypes)].filter((t) => !done.includes(t));
  const amount = types.length === 0 ? 0 : expAmountOf(balance.xp.firstGoal, levelOf(companyExp, balance), balance);
  return { types, gained: types.length * amount };
};
