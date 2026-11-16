// 保存の枠。経営もサンドボックスも同じ1つの範囲（FIRST_SLOT から SLOT_COUNT 個）の空いた番号を使う。
// どちらの遊び方の会社かは、枠の番号ではなく会社の記録の mode で分ける。
// 移行前のセーブ（経営は枠1、サンドボックスは枠2）は、範囲の空いた枠へ移す。
import type { GameMode } from '../company/company';

// 範囲の最初の番号
export const FIRST_SLOT = 11;

// 範囲の大きさ（枠の総数）
export const SLOT_COUNT = 50;

// 空いた枠を探す範囲
export const SLOT_RANGE: readonly number[] = Array.from({ length: SLOT_COUNT }, (_, i) => FIRST_SLOT + i);

// 移行前の枠（moveLegacySlots が範囲の空いた枠へ移す）
export const LEGACY_SLOT: Record<GameMode, number> = { career: 1, sandbox: 2 };

// 読めない枠は遊び方を読めないため、以前の番号から推し量る。以前の番号の枠は元の遊び方、それ以外の番号の枠は null（どちらの一覧にも出す）
const FORMER_SLOTS: Record<GameMode, readonly number[]> = { career: [1, 11, 12, 13, 14, 15], sandbox: [2, 21, 22, 23] };
export const modeOfBrokenSlot = (slot: number): GameMode | null => (Object.keys(FORMER_SLOTS) as GameMode[]).find((mode) => FORMER_SLOTS[mode].includes(slot)) ?? null;
