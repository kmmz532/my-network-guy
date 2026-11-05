// 自動保存の判定と、保存の直列化。React に依存しないので、テストで直接確かめる。
import type { AutoSaveMode } from '../settings/settings';
import { minutesPerDay } from '../sim/clock';

// 間隔の日数。しない（off）は保存しないので null
export const autoSavePeriodDays = (mode: AutoSaveMode): number | null => {
  if (mode === 'daily') return 1;
  if (mode === 'weekly') return 7;
  return null;
};

// ゲーム内の時間が prevMinute から nextMinute へ進んだとき、間隔に当たる朝0時を越えたか。
// 日の番号（開始日を0とする）を間隔で割った商が増えたときに当たる。時間が戻ったとき（読み込み）は当たらない。
export const isAutoSaveDue = (mode: AutoSaveMode, prevMinute: number, nextMinute: number): boolean => {
  const period = autoSavePeriodDays(mode);
  if (period === null || nextMinute <= prevMinute) return false;
  const prevDay = Math.floor(prevMinute / minutesPerDay);
  const nextDay = Math.floor(nextMinute / minutesPerDay);
  return Math.floor(nextDay / period) > Math.floor(prevDay / period);
};

// 保存の直列化。実行中に要求が来たら、実行が終わってから1回だけ行う（要求が何件来ても、待ちは1回分）。
// 戻り値の Promise は、その要求を満たす実行が終わったときに解決する。task の例外は呼び出し側へ出さない。
export function createSaveQueue(task: () => Promise<void>): () => Promise<void> {
  let busy = false;
  let waiting: Promise<void> | null = null;
  let resolveWaiting: (() => void) | null = null;

  const drain = async (): Promise<void> => {
    busy = true;
    try {
      while (waiting) {
        // 待ちを取り出してから実行する。実行中に来た要求は次の1回に含まれる
        const resolve = resolveWaiting;
        waiting = null;
        resolveWaiting = null;
        try {
          await task();
        } catch {
          // 保存に失敗しても、次の要求は受け付ける
        }
        resolve?.();
      }
    } finally {
      busy = false;
    }
  };

  return () => {
    if (!waiting) waiting = new Promise<void>((resolve) => (resolveWaiting = resolve));
    const done = waiting;
    if (!busy) void drain();
    return done;
  };
}
