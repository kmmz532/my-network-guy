// 型紙なしで任せる（結果を乱数で決める）。設計は作らず、担当の能力と職種の一致から、費用の割合と手直しの回数を決め、★を出す。
// 純粋な関数。乱数は決定的な状態（rng.ts）を引数で受け取り、更新後の状態を返す。
import type { Balance } from '../data/schema';
import { rand } from './rng';

export type Stars = 1 | 2;

// 担当の能力（0〜1）。担当の施工力の合計を PC の台数で割った値と、職種の一致の割合を、balance.delegate.matchWeight で混ぜる
export const qualityOf = (power: number, pcCount: number, match: number, balance: Balance): number => {
  const d = balance.delegate;
  const perPc = pcCount > 0 ? power / pcCount : 0;
  const ability = Math.min(1, perPc / d.powerForFull);
  return ability * (1 - d.matchWeight) + Math.min(1, Math.max(0, match)) * d.matchWeight;
};

const lerp = (from: number, to: number, t: number): number => from + (to - from) * t;

// 費用の割合（費用 ÷ 予算）。能力が高いほど下がる。noise は −1〜1
export const costRatioOf = (q: number, noise: number, balance: Balance): number =>
  Math.max(0, lerp(balance.delegate.worstCostRatio, balance.delegate.bestCostRatio, q) + noise * balance.delegate.noiseWidth);

// 手直しの回数。能力が高いほど少ない
export const reworkOf = (q: number, noise: number, balance: Balance): number =>
  Math.max(0, Math.round(lerp(balance.delegate.worstRework, 0, q) + noise * balance.delegate.reworkNoise));

// ★（上限2）。balance.rating の 2 の条件を満たせば2、そうでなければ1
export const starsFor = (costRatio: number, rework: number, balance: Balance): Stars => {
  const two = balance.rating.find((r) => r.stars === 2);
  if (two && two.maxCostRatio !== null && two.maxRework !== null && costRatio <= two.maxCostRatio && rework <= two.maxRework) return 2;
  return 1;
};

// 結果の範囲（乱数を0とみなす。最悪と最良の能力での★）。結果を出す前に、予想の★として見せる
export const starRangeOf = (power: number, pcCount: number, match: number, balance: Balance): [Stars, Stars] => {
  const q = qualityOf(power, pcCount, match, balance);
  const worst = starsFor(costRatioOf(0, 0, balance), reworkOf(0, 0, balance), balance);
  const best = starsFor(costRatioOf(1, 0, balance), reworkOf(1, 0, balance), balance);
  const at = starsFor(costRatioOf(q, 0, balance), reworkOf(q, 0, balance), balance);
  return [Math.min(worst, at) as Stars, Math.max(best, at) as Stars];
};

export interface BlindResult {
  stars: Stars;
  costRatio: number;
  rework: number;
  rng: number;
}

// 結果を乱数で決める。乱数は2回使う（費用の割合のぶれと、手直しのぶれ）
export const blindDelegation = (power: number, pcCount: number, match: number, balance: Balance, rng: number): BlindResult => {
  const q = qualityOf(power, pcCount, match, balance);
  const a = rand(rng);
  const b = rand(a.state);
  const costRatio = costRatioOf(q, a.value * 2 - 1, balance);
  const rework = reworkOf(q, b.value * 2 - 1, balance);
  return { stars: starsFor(costRatio, rework, balance), costRatio, rework, rng: b.state };
};
