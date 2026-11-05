// 納品の期日（GAME.md「4. 決定」）。受注日からの日数で期日（ゲーム内の日の番号）を決め、遅れた日数で報酬の割合を決める。
import type { Balance } from '../data/schema';
import { minutesPerDay } from './clock';

// ゲーム内の日の番号（開始日が0）
export const dayOf = (minute: number): number => Math.floor(minute / minutesPerDay);

// 受注日からの期日を、期日の日の番号にする。期日のない案件（自社案件）は null
export const dueDayOf = (acceptMinute: number, deadlineDays: number | undefined): number | null =>
  deadlineDays === undefined ? null : dayOf(acceptMinute) + deadlineDays;

// 納品が遅れた日数。期日内（期日の日を含む）は0
export const lateDaysOf = (due: number | null, deliveryMinute: number): number =>
  due === null ? 0 : Math.max(0, dayOf(deliveryMinute) - due);

// 報酬に掛ける割合。遅れた日数ごとに lateRatePerDay ずつ下がり、lateFloor より下がらない
export const lateFactor = (lateDays: number, balance: Balance): number =>
  Math.max(balance.deadline.lateFloor, 1 - balance.deadline.lateRatePerDay * lateDays);
