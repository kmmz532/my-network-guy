// 納品時の★評価。予算に対する費用の割合と、検収の失敗回数（手戻り）で決まる。
import type { Balance } from '../data/schema';

export const rate = (cost: number, budget: number, rework: number, balance: Balance): 1 | 2 | 3 => {
  const ratio = budget > 0 ? cost / budget : Infinity;
  // balance.rating は高い評価から並んでいる
  for (const r of balance.rating) {
    const costOk = r.maxCostRatio === null || ratio <= r.maxCostRatio;
    const reworkOk = r.maxRework === null || rework <= r.maxRework;
    if (costOk && reworkOk) return r.stars;
  }
  return 1;
};
