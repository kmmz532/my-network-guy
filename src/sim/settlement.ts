// 納品の精算（報酬と会社の経験値）。検収と型紙なしの納品、釣り合いのシミュレーションが同じ式を使う。純粋な関数。
import type { Balance } from '../data/schema';
import { lateFactor } from './deadline';
import { DELEGATED_EXP_DIVISOR } from './familiar';
import { deliveryExpOf, levelOf } from './level';
import { rewardRateOf, type Stars } from './rating';

export interface SettlementInput {
  // 依頼の報酬（contract.reward.money）と解放のレベル
  reward: number;
  unlockLevel: number;
  stars: Stars;
  // 期日に遅れた日数（遅れなければ 0）
  lateDays: number;
  // 任せた依頼は経験値を半分にする
  delegated: boolean;
  companyExp: number;
}

// 報酬は、期日の割合と★ごとの倍率を掛けた額。経験値は、現在のレベルの必要経験値に割合と★の倍率を掛けた量（任せた依頼は半分・最小1）
export const settlementOf = (input: SettlementInput, balance: Balance): { money: number; expGain: number } => {
  const rate = rewardRateOf(input.stars, balance);
  const money = Math.round(input.reward * lateFactor(input.lateDays, balance) * rate);
  const full = deliveryExpOf(input.unlockLevel, levelOf(input.companyExp, balance), rate, balance);
  return { money, expGain: input.delegated ? Math.max(1, Math.floor(full / DELEGATED_EXP_DIVISOR)) : full };
};

// 型紙なしで任せた依頼の費用（予算 × 費用の割合）
export const blindCostOf = (budget: number, costRatio: number): number => Math.round(budget * costRatio);
