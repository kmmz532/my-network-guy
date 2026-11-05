// 保存の枠。遊び方（mode）ごとに別の枠を使う。career は従来の枠 1、sandbox は枠 2
import type { GameMode } from './migrations';

export const SAVE_SLOT: Record<GameMode, number> = { career: 1, sandbox: 2 };

export const slotOf = (mode: GameMode): number => SAVE_SLOT[mode];
