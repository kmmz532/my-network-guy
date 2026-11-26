// 帳簿（資金の画面の土台）。お金の増減は、すべて applyMoney を通す。分類のない増減は書けない。
// 記録は取引ごとではなく、月ごと・分類ごとの合計で持つ（直近 LEDGER_MONTHS か月だけ残す）。
// サンドボックスは記録しない（時計の ledger が null）。
import balanceJson from '../../resources/data/balance.json';
import type { ClockState } from './clock';

export const LEDGER_CATEGORIES = [
  'reward',
  'rental',
  'dev',
  'sale',
  'salary',
  'purchase',
  'construction',
  'expansion',
  'training',
  'exam',
  'retirement',
  // 自社の床の張り替え（N92）
  'interior',
  // 経理の割引で浮いた額（お金の増減ではない。支出とは別に記録する）
  'saved',
  // 経理の節税（月末に、その月の手間賃（報酬から機器の費用の分を除いた額）の一部が資金に戻る）
  'taxReturn',
  // 報酬のうち、機器の費用の分（お金の増減ではない。報酬の内訳として記録し、節税の対象から除く）
  'rewardEquipment',
] as const;
export type LedgerCategory = (typeof LEDGER_CATEGORIES)[number];

export interface LedgerMonth {
  // ゲーム内の月の番号（0 から。年・月の表示は toDate で求める）
  month: number;
  // 分類ごとの合計。収入は正、支出は負
  totals: Record<LedgerCategory, number>;
}

export const LEDGER_MONTHS = 12;

export const emptyTotals = (): Record<LedgerCategory, number> =>
  Object.fromEntries(LEDGER_CATEGORIES.map((c) => [c, 0])) as Record<LedgerCategory, number>;

// お金の増減ではない分類（内訳の記録）。収支の合計には含めない
export const MEMO_CATEGORIES: readonly LedgerCategory[] = ['saved', 'rewardEquipment'];

// 資金を変えずに、今月の分類の合計に記録する。帳簿がなければ何もしない
const recordMemo = (clock: ClockState, amount: number, category: LedgerCategory): ClockState => {
  if (amount <= 0 || clock.ledger === null) return clock;
  const monthLength = balanceJson.time.daysPerMonth * 24 * 60;
  const month = Math.floor(clock.minute / monthLength);
  const kept = clock.ledger.filter((m) => m.month > month - LEDGER_MONTHS && m.month !== month);
  const current = clock.ledger.find((m) => m.month === month) ?? { month, totals: emptyTotals() };
  const updated: LedgerMonth = { month, totals: { ...current.totals, [category]: current.totals[category] + amount } };
  return { ...clock, ledger: [...kept, updated].sort((a, b) => a.month - b.month) };
};

// 経理の割引で浮いた額を、今月の節約に記録する（資金は変えない）
export const recordSaving = (clock: ClockState, amount: number): ClockState => recordMemo(clock, amount, 'saved');

// 納品した報酬のうち、機器の費用の分を記録する（資金は変えない）
export const recordRewardEquipment = (clock: ClockState, amount: number): ClockState => recordMemo(clock, amount, 'rewardEquipment');

// 指定した月の分類の合計（記録がなければ0。帳簿がなければ0）
export const ledgerTotalOf = (clock: ClockState, month: number, category: LedgerCategory): number =>
  clock.ledger?.find((m) => m.month === month)?.totals[category] ?? 0;

// お金を増減させる（amount は収入なら正、支出なら負）。帳簿が有効なら、今月の分類の合計に足す
export const applyMoney = (clock: ClockState, amount: number, category: LedgerCategory): ClockState => {
  if (amount === 0) return clock;
  const money = clock.money + amount;
  if (clock.ledger === null) return { ...clock, money };
  // 月の長さは時間の設定（balance.json）と同じ。帳簿の月は、ゲーム内の月と一致させる
  const monthLength = balanceJson.time.daysPerMonth * 24 * 60;
  const month = Math.floor(clock.minute / monthLength);
  const kept = clock.ledger.filter((m) => m.month > month - LEDGER_MONTHS && m.month !== month);
  const current = clock.ledger.find((m) => m.month === month) ?? { month, totals: emptyTotals() };
  const updated: LedgerMonth = { month, totals: { ...current.totals, [category]: current.totals[category] + amount } };
  return { ...clock, money, ledger: [...kept, updated].sort((a, b) => a.month - b.month) };
};
