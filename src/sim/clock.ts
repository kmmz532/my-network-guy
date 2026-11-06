// 固定Tickの時間進行と、月末の給与・倒産判定。1 Tick は balance.time.gameMinutesPerTick 分進む。
import type { Balance } from '../data/schema';
import { applyMoney, type LedgerMonth } from './ledger';

export interface ClockState {
  minute: number;
  money: number;
  paidMonths: number;
  bankrupt: boolean;
  // 帳簿（月ごとの分類の合計）。サンドボックスは null（記録しない）
  ledger: LedgerMonth[] | null;
}

export const minutesPerDay = 24 * 60;

export const minutesPerMonth = (balance: Balance) => balance.time.daysPerMonth * minutesPerDay;

// 新しく始めるときは、勤務の開始時刻（workStartHour）から始める（夜の空いた事務所から始まらないように）
export const initialClock = (balance: Balance): ClockState => ({
  minute: balance.build.workStartHour * 60,
  money: balance.startMoney,
  paidMonths: 0,
  bankrupt: false,
  ledger: [],
});

// 1 Tick 進める。月の境界を越えたら、雇用中の社員の月給の合計（monthlyPay）を支払い、資金が0円未満なら倒産とする
export const advanceTick = (state: ClockState, balance: Balance, monthlyPay: number): ClockState => {
  if (state.bankrupt) return state;
  const minute = state.minute + balance.time.gameMinutesPerTick;
  let clock: ClockState = { ...state, minute };
  const monthLength = minutesPerMonth(balance);
  while ((clock.paidMonths + 1) * monthLength <= minute) {
    // 給与は月の区切りで払い、帳簿の給与の分類に記録する
    clock = { ...applyMoney(clock, -monthlyPay, 'salary'), paidMonths: clock.paidMonths + 1 };
    if (clock.money < 0) {
      clock = { ...clock, bankrupt: true };
      break;
    }
  }
  return clock;
};

// 1年の月数（ゲーム内の暦）
export const monthsPerYear = 12;

// ゲーム内の日時表示用。年・月は1から始まり、月は年の中の月（1〜12）
export const toDate = (minute: number, balance: Balance) => {
  const monthLength = minutesPerMonth(balance);
  const monthCount = Math.floor(minute / monthLength);
  const year = Math.floor(monthCount / monthsPerYear) + 1;
  const month = (monthCount % monthsPerYear) + 1;
  const day = Math.floor((minute % monthLength) / minutesPerDay) + 1;
  const hour = Math.floor((minute % minutesPerDay) / 60);
  return { year, month, day, hour };
};

// 社員が事務所にいる時刻（出社の時刻から終業まで）。分（その日の0時からの分）で決める
export const isPresentMinute = (minuteOfDay: number, balance: Balance): boolean =>
  minuteOfDay >= balance.build.workStartHour * 60 - balance.build.arriveMinutesBefore && minuteOfDay < balance.build.workEndHour * 60;

// 勤務時間内か（施工は勤務時間内にしか進まない）
export const isWorkingHour = (hour: number, balance: Balance): boolean =>
  hour >= balance.build.workStartHour && hour < balance.build.workEndHour;
