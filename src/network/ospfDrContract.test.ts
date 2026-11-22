// 案件 o003（指定ルーターを DR にする）: 置いたままでは部門Bのルーター（ルーター ID が最大）が DR になる。中核のルーターの優先度を上げると、中核のルーターが DR になり合格する
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/o003_ospf_dr.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const network = (corePriority?: number): Network => ({
  nodes: fixedNodes(contract).map((n) =>
    n.uid === 'r_core' && corePriority !== undefined ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, ospf: { ...i.ospf!, priority: corePriority } })) } : n,
  ),
  links: contractLinks(contract),
  plans: {},
});

describe('案件 o003: 指定ルーターを DR にする', () => {
  it('置いたままでは不合格で、中核のルーターの優先度を上げると合格する', () => {
    expect(evaluateContract(contract, analyze(network(), data)).passed).toBe(false);
    expect(evaluateContract(contract, analyze(network(10), data)).passed).toBe(true);
  });
});
