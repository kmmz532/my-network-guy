// 勤務の区分（N48）。日勤は勤務時間（workStartHour〜workEndHour）、夜勤は夜の勤務時間（nightStartHour〜翌 nightEndHour）。
// 時刻は、その日の0時からの分で扱う。夜勤は日をまたぐ。
import type { Balance } from '../data/schema';

export type Shift = 'day' | 'night';

// 区分の勤務の始まりと終わり（分）。夜勤の終わりは翌日の分として 1440 を足した値
export const shiftWindowOf = (shift: Shift, balance: Balance): { start: number; end: number } =>
  shift === 'day'
    ? { start: balance.build.workStartHour * 60, end: balance.build.workEndHour * 60 }
    : { start: balance.build.nightStartHour * 60, end: balance.build.nightEndHour * 60 + 24 * 60 };

// その時刻（その日の0時からの分）に、区分の勤務中か
export const isOnShift = (minuteOfDay: number, shift: Shift, balance: Balance): boolean => {
  const { start, end } = shiftWindowOf(shift, balance);
  const m = minuteOfDay;
  return m >= start && m < end || (m + 24 * 60 >= start && m + 24 * 60 < end);
};

// 事務所にいる時刻（出社の時刻から勤務の終わりまで）。出社は始業（夜勤は夜の始業）の arriveMinutesBefore 分前から
export const isPresentOnShift = (minuteOfDay: number, shift: Shift, balance: Balance): boolean => {
  const { start, end } = shiftWindowOf(shift, balance);
  const lead = balance.build.arriveMinutesBefore;
  const m = minuteOfDay;
  return (m >= start - lead && m < end) || (m + 24 * 60 >= start - lead && m + 24 * 60 < end);
};

// その時刻（その日の0時からの分）を、区分の勤務の時間の座標に直す。夜勤は、0時をまたいだ時刻を 1440 を足して扱う
export const minuteInShift = (minuteOfDay: number, shift: Shift, balance: Balance): number => {
  const { start } = shiftWindowOf(shift, balance);
  return minuteOfDay < start && shift === 'night' ? minuteOfDay + 24 * 60 : minuteOfDay;
};
