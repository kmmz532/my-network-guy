// 達成条件ごとに、現在の設計で満たしているかを判定する（施工前の確認に使う）。
import type { Contract, Goal } from '../data/schema';
import { evaluateContract } from '../network/goals';
import type { EngineData, FailureReason, NetLink, NetNode } from '../network/types';

export interface GoalStatus {
  goal: Goal;
  ok: boolean;
  // 満たせなかった理由（重複は除く）
  reasons: FailureReason[];
}

export const goalStatus = (
  contract: Contract,
  nodes: NetNode[],
  links: NetLink[],
  engine: EngineData,
): GoalStatus[] => {
  const { results } = evaluateContract(contract, { nodes, links }, engine);
  return contract.goals.map((goal) => {
    const own = results.filter((r) => r.goal === goal);
    const reasons = [...new Set(own.filter((r) => !r.ok && r.failure).map((r) => r.failure!.reason))];
    return { goal, ok: own.every((r) => r.ok), reasons };
  });
};
