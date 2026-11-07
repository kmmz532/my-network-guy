// 時間の速さ（N99）。停止・1倍・2倍は最初から使え、4倍・8倍は会社のレベルで解放する。純粋な関数。
import type { Balance } from '../data/schema';

// 解放されている速さ（0 の停止を含む、昇順）
export const unlockedSpeedsOf = (level: number, balance: Balance): number[] =>
  balance.time.speeds.filter((speed) => {
    const unlock = balance.time.speedUnlockLevels[String(speed)];
    return unlock === undefined || level >= unlock;
  });

export const isSpeedUnlocked = (speed: number, level: number, balance: Balance): boolean =>
  unlockedSpeedsOf(level, balance).includes(speed);

// 早送り（2倍以上）の次の速さ。解放済みの早送りを昇順に回し、最後の次は最初に戻る。早送りでなければ最初の早送り
export const nextFastSpeed = (current: number, unlocked: readonly number[]): number => {
  const fast = unlocked.filter((speed) => speed >= 2);
  return fast.find((speed) => speed > current) ?? fast[0] ?? 2;
};
