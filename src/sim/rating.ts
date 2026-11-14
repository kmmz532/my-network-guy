// 納品時の★評価。予算に対する費用の割合と、検収の失敗回数（手戻り）で決まる。期日に遅れた案件と、設計の不備がある案件は★2が上限。
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

// ★を決める。遅れた案件、設計の不備が1つ以上ある案件は★2を上限にする
export const rate = (cost: number, budget: number, rework: number, late: boolean, issues: number, balance: Balance): Stars => {
  const stars = starsOf(cost, budget, rework, balance);
  return late || issues > 0 ? (Math.min(stars, 2) as Stars) : stars;
};

// 修理の依頼の★: 最初の状態からの変更の数が minChanges 以下で★3、2倍以下で★2、それより多ければ★1。★3には費用の条件（★3の費用の割合）も要る。テストは無料のため、手戻りは数えない
export const repairStarsOf = (changes: number, minChanges: number, cost: number, budget: number, balance: Balance): Stars => {
  const top = balance.rating.find((r) => r.stars === 3);
  if (!top) throw new Error('balance.rating に★3がない');
  const ratio = budget > 0 ? cost / budget : Infinity;
  const costOk = top.maxCostRatio === null || ratio <= top.maxCostRatio;
  if (changes <= minChanges) return costOk ? 3 : 2;
  return changes <= minChanges * 2 ? 2 : 1;
};

// ★ごとの報酬の倍率（balance.rating の rewardRate）
export const rewardRateOf = (stars: Stars, balance: Balance): number =>
  balance.rating.find((r) => r.stars === stars)?.rewardRate ?? 1;
