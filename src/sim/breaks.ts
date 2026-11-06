// 社員の休憩の予定（N42）。その日の休憩は、社員と日付から決まる（同じ日なら何度計算しても同じ）。
// 1回は minMinutes 以上、1日に maxPerDay 回まで、合計は maxMinutesPerDay まで。休憩は勤務時間の中に入る。
import type { Balance } from '../data/schema';
import { randInt } from './rng';
import { shiftWindowOf, type Shift } from './shift';

export interface Break {
  // その日の0時からの分
  start: number;
  length: number;
}

// 文字列から乱数の種を作る（同じ文字列からは同じ種）
const seedOf = (text: string): number => {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
};

// 社員 uid の、day 日目の休憩の予定（区分の勤務時間の中。夜勤は夜の時間の中。時刻は区分の座標）
export const breakPlanOf = (uid: string, day: number, balance: Balance, shift: Shift = 'day'): Break[] => {
  const cfg = balance.breaks;
  const window = shiftWindowOf(shift, balance);
  const count = randInt(seedOf(`${uid}:${day}`), 0, cfg.maxPerDay);
  let state = count.state;
  // 勤務時間の中央に近い区間を、休憩の数で分ける（始業と終業の1時間は空ける）
  const from = window.start + 60;
  const to = window.end - 60;
  const slot = Math.max(1, Math.floor((to - from) / (cfg.maxPerDay + 1)));
  const plan: Break[] = [];
  let total = 0;
  let previousEnd = from;
  for (let i = 0; i < count.value; i++) {
    const length = randInt(state, cfg.minMinutes, cfg.maxMinutes);
    state = length.state;
    if (total + length.value > cfg.maxMinutesPerDay) break;
    const jitter = randInt(state, -Math.floor(slot / 4), Math.floor(slot / 4));
    state = jitter.state;
    const start = Math.max(previousEnd, Math.min(to - length.value, from + slot * (i + 1) + jitter.value));
    if (start + length.value > to) break;
    plan.push({ start, length: length.value });
    previousEnd = start + length.value;
    total += length.value;
  }
  return plan;
};

// その時刻（その日の0時からの分）にかかっている休憩
export const breakAt = (minuteOfDay: number, plan: readonly Break[]): Break | null =>
  plan.find((b) => minuteOfDay >= b.start && minuteOfDay < b.start + b.length) ?? null;
