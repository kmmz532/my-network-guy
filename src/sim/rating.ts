// 納品時の★評価。予算に対する費用の割合と、検収の失敗回数（手戻り）で決まる。期日に遅れた案件は★2が上限。
import type { Balance } from '../data/schema';

export type Stars = 1 | 2 | 3;

// 費用と手戻りだけで決まる★（期日は考えない）
const starsOf = (cost: number, budget: number, rework: number, balance: Balance): Stars => {
  const ratio = budget > 0 ? cost / budget : Infinity;
  // balance.rating は高い評価から並んでいる
  for (const r of balance.rating) {
    const costOk = r.maxCostRatio === null || ratio <= r.maxCostRatio;
    const reworkOk = r.maxRework === null || rework <= r.maxRework;
    if (costOk && reworkOk) return r.stars;
  }
  return 1;
};

// ★を決める。遅れた案件は★2を上限にする
export const rate = (cost: number, budget: number, rework: number, late: boolean, balance: Balance): Stars => {
  const stars = starsOf(cost, budget, rework, balance);
  return late ? (Math.min(stars, 2) as Stars) : stars;
};

// ★ごとの報酬の倍率（balance.rating の rewardRate）
export const rewardRateOf = (stars: Stars, balance: Balance): number =>
  balance.rating.find((r) => r.stars === stars)?.rewardRate ?? 1;
