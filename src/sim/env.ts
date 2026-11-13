// ゲームデータから、案件の流れと判定に使う環境を作る（実行時のみ使用）。機器・ケーブルの定義は登録表から引く。
import { balance } from 'virtual:game-data';
import { furnitureById } from '../registry/query';
import type { Env } from './project';
import { isPcIn } from './project';

export const gameEnv: Env = {
  balance,
  furniture: furnitureById,
  engine: { wallAt: () => false },
};

// 機器の種類が PC かどうか（N102）
export const isPcDevice = (device: string): boolean => isPcIn(gameEnv, device);
