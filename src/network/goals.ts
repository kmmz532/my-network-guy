// 案件の達成条件（goals）の判定ハンドラ。種類ごとにハンドラを登録し、案件データから呼び出す。
import type { Contract, Goal } from '../data/schema';
import { http, ping } from './engine';
import type { EngineData, Failure, Network, PathResult } from './types';

export interface GoalResult {
  goal: Goal;
  ok: boolean;
  failure?: Failure;
  // 判定した経路（自動検収でパケットを流すために使う）
  kind: 'ping' | 'http';
  src: string;
  dst: string;
  result: PathResult;
}

type Handler = (goal: Goal, net: Network, data: EngineData) => GoalResult[];

// 案件の placed[].ref は配置した機器のuidとして扱う
const handlers: { [K in Goal['type']]: Handler } = {
  ping: (goal, net, data) => {
    if (goal.type !== 'ping') throw new Error('ping ハンドラに別の種類が渡された');
    const r = ping(net, data, goal.from, goal.to);
    return [{ goal, ok: r.ok, failure: r.failure, kind: 'ping', src: goal.from, dst: goal.to, result: r }];
  },
  ping_all: (goal, net, data) => {
    if (goal.type !== 'ping_all' || goal.nodes === '$all_pcs') {
      throw new Error('ping_all の nodes は実体化されていなければならない');
    }
    // 疎通は往復で判定するため、組み合わせは順不同の全ペアで足りる
    const results: GoalResult[] = [];
    const nodes = goal.nodes;
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const r = ping(net, data, nodes[i], nodes[j]);
        results.push({ goal, ok: r.ok, failure: r.failure, kind: 'ping', src: nodes[i], dst: nodes[j], result: r });
      }
    }
    return results;
  },
  http: (goal, net, data) => {
    if (goal.type !== 'http') throw new Error('http ハンドラに別の種類が渡された');
    const r = http(net, data, goal.from, goal.to, goal.port);
    return [{ goal, ok: r.ok, failure: r.failure, kind: 'http', src: goal.from, dst: goal.to, result: r }];
  },
};

// 1つの達成条件を判定する。ping_all は全ペアの結果を返す
export const evaluateGoal = (goal: Goal, net: Network, data: EngineData): GoalResult[] => handlers[goal.type](goal, net, data);

export interface ContractResult {
  passed: boolean;
  results: GoalResult[];
}

// 案件のすべての達成条件を判定する。すべて成立したときに合格とする
export const evaluateContract = (contract: Contract, net: Network, data: EngineData): ContractResult => {
  const results = contract.goals.flatMap((goal) => evaluateGoal(goal, net, data));
  return { passed: results.every((r) => r.ok), results };
};
