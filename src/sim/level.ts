// 会社のレベル（N45。LEVEL.md §3・§5）。必要な経験値と毎回の報酬は式で決め、表は持たない。
// 解放は品目の unlockLevel で決まる。節目の報酬は levels.json に書く。
import type { Balance } from '../data/schema';

// Lv n から Lv n+1 に上がるのに必要な経験値（式）
export const needOf = (n: number, balance: Balance): number => Math.round(balance.level.base * Math.pow(n, balance.level.power));

// Lv n になるのに必要な累計の経験値（Lv1 は 0）
export const expAtLevel = (n: number, balance: Balance): number => {
  let total = 0;
  for (let k = 1; k < n; k++) total += needOf(k, balance);
  return total;
};

// 累計の経験値からレベル（最大は balance.level.max）
export const levelOf = (exp: number, balance: Balance): number => {
  let level = 1;
  let threshold = needOf(1, balance);
  let reached = 0;
  while (level < balance.level.max && exp >= reached + threshold) {
    reached += threshold;
    level++;
    threshold = needOf(level, balance);
  }
  return level;
};

// 次のレベルと、あと何点か。最大レベルなら null
export const nextLevel = (exp: number, balance: Balance): { level: number; need: number } | null => {
  const level = levelOf(exp, balance);
  if (level >= balance.level.max) return null;
  return { level: level + 1, need: expAtLevel(level + 1, balance) - exp };
};

// Lv n に上がったときの、毎回のお金（1000 円単位）
export const moneyOf = (n: number, balance: Balance): number =>
  Math.round((balance.level.moneyBase * Math.pow(n, balance.level.moneyPower)) / 1000) * 1000;

// 品目の解放（unlockLevel が今のレベル以下なら解放済み）
export const isUnlocked = (unlockLevel: number, level: number): boolean => unlockLevel <= level;

// Lv100 以上の称号（100の倍数ごと。Lv999 は専用の称号）。称号のない Lv は null
export const titleKeyOf = (level: number): string | null => {
  if (level === 999) return 'level.title.999';
  if (level >= 100 && level % 100 === 0) return `level.title.${level}`;
  return null;
};
