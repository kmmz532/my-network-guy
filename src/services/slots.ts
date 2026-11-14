// 保存の枠（N133）。経営もサンドボックスも、遊び方ごとに複数の枠を持つ（枠は共有しない）。
// 移行前のセーブ（経営は枠1、サンドボックスは枠2）は、それぞれの遊び方の1つ目の枠へ移す。
import type { GameMode } from '../company/company';

// 遊び方ごとの会社の枠。経営は5つ、サンドボックスは3つ
export const SLOTS: Record<GameMode, readonly number[]> = {
  career: [11, 12, 13, 14, 15],
  sandbox: [21, 22, 23],
};

// 移行前の枠（この版で SLOTS の1つ目へ移す）
export const LEGACY_SLOT: Record<GameMode, number> = { career: 1, sandbox: 2 };
