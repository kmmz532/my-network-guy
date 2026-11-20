// 案件 s001（2つの棟を10Gでつなぐ）: 2台の L3 スイッチの SFP の口どうしを光ファイバーでつなぐと合格する（経路の設定は要らない）。rj45 の口どうしを cat6a でつなぐと、口の 1G で speed.slow
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/s001_10g_uplink.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract, evaluateGoal } from './goals';
import type { NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;
const minSpeed = contract.goals.find((g) => g.type === 'min_speed')!;

const cable = (uid: string, cableId: string, a: string, aPort: number, b: string, bPort: number, path: [number, number][]): NetLink => ({
  uid,
  cable: cableId,
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path,
  paid: 0,
});

const net = (nodes: NetNode[], uplink: NetLink): Network => ({
  nodes,
  links: [...contractLinks(contract), uplink],
  plans: {},
});

describe('案件 s001: 2つの棟を10Gでつなぐ', () => {
  it('SFP の口どうしを光ファイバーでつなぐと合格する', () => {
    const fiber = cable('uplink', 'fiber_mm', 'HQ_SW', 8, 'DC_SW', 8, [[8, 5], [27, 5]]);
    expect(evaluateContract(contract, analyze(net(fixedNodes(contract), fiber), data)).passed).toBe(true);
  });
  it('rj45 の口どうしを cat6a でつなぐと、口の 1G で speed.slow', () => {
    const copper = cable('uplink', 'cat6a', 'HQ_SW', 1, 'DC_SW', 1, [[8, 5], [27, 5]]);
    const results = evaluateGoal(minSpeed, analyze(net(fixedNodes(contract), copper), data));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => !r.ok && r.failure?.reason === 'speed.slow')).toBe(true);
  });
});
