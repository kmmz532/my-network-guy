// 達成条件 max_devices（制約の依頼）: 指定の分類の機器が、ネットワークの中に上限以下しかなければ合格する（固定で置かれた機器も数える）
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/c002_small_office.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { Network } from './types';

const base = contractJson as unknown as Contract;
const data = gameEnv.engine;

// c002 の PC は固定で3台。PC の台数を上限にする達成条件だけを持つ案件として判定する
const passedWithMax = (max: number): boolean => {
  const contract: Contract = { ...base, goals: [{ type: 'max_devices', category: 'pc', max }] };
  const net: Network = { nodes: fixedNodes(contract), links: contractLinks(contract), plans: {} };
  return evaluateContract(contract, analyze(net, data)).passed;
};

describe('達成条件 max_devices', () => {
  it('分類の機器が上限を超えると不合格、上限以下なら合格する', () => {
    expect(passedWithMax(2)).toBe(false);
    expect(passedWithMax(3)).toBe(true);
  });
});
