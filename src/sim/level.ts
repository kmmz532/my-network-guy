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

// 上がったレベルごとの報酬と、そのレベルで解放された品目（LEVEL.md 6）
export interface LevelUp {
  level: number;
  money: number;
  devices: { device: string; count: number }[];
  unlocks: { kind: 'device' | 'cable' | 'furniture' | 'template' | 'contract' | 'speed' | 'floor' | 'feature'; id: string }[];
}

export interface UnlockItem {
  kind: LevelUp['unlocks'][number]['kind'];
  id: string;
  unlockLevel: number;
}

// Lv before から Lv after までに上がった各レベルの報酬と解放（before は含まず、after は含む）
export const levelUpsBetween = (
  before: number,
  after: number,
  balance: Balance,
  milestones: readonly { level: number; reward: { devices: { device: string; count: number }[] } }[],
  items: readonly UnlockItem[],
): LevelUp[] => {
  const out: LevelUp[] = [];
  for (let n = before + 1; n <= after; n++) {
    out.push({
      level: n,
      money: moneyOf(n, balance),
      devices: milestones.filter((m) => m.level === n).flatMap((m) => m.reward.devices),
      unlocks: items.filter((i) => i.unlockLevel === n).map((i) => ({ kind: i.kind, id: i.id })),
    });
  }
  return out;
};

// 経験値の量の割合（balance.exp）を、現在のレベルの必要経験値に掛けた量（LEVEL.md の割合の方針。N55）。最小は 1
export const expAmountOf = (rate: number, level: number, balance: Balance): number =>
  Math.max(1, Math.round(needOf(level, balance) * rate));

// 1日の上限（繰り返せる源の合計）。最小は 2
export const dailyExpCapOf = (level: number, balance: Balance): number =>
  Math.max(2, Math.round(needOf(level, balance) * balance.exp.dailyCap));

// 納品の経験値。現在のレベルの必要経験値に割合を掛け、★の報酬の倍率（rewardRate）を掛ける。
// 案件の解放レベルが現在のレベルより低いほど減る（1レベルごとに deliveryGapStep、下限 deliveryGapMin）。古い依頼だけを繰り返しても上がるが、新しい種類の方が早い
export const deliveryExpOf = (unlockLevel: number, level: number, starRate: number, balance: Balance): number => {
  const gap = Math.max(balance.exp.deliveryGapMin, 1 - balance.exp.deliveryGapStep * Math.max(0, level - unlockLevel));
  return Math.max(1, Math.round(needOf(level, balance) * balance.exp.delivery * gap * starRate));
};

// 今のレベルの中での進み具合（0〜1）。レベルの境目で 0 になり、次のレベルの直前で 1 に近づく。最大レベルは満ちたまま（N66）
export const levelProgressOf = (exp: number, balance: Balance): number => {
  const level = levelOf(exp, balance);
  if (level >= balance.level.max) return 1;
  const start = expAtLevel(level, balance);
  return Math.min(1, Math.max(0, (exp - start) / needOf(level, balance)));
};
