// 案件 rt001（3つの拠点を RIP でつなぐ）: 工場のルーターを本社と倉庫のルーターにつなぎ、3台すべてで RIP を動かすと合格する。静的経路は使わない
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../assets/data/contracts/rt001_rip_three_sites.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const cable = (uid: string, a: string, aPort: number, b: string, bPort: number, path: [number, number][]): NetLink => ({
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path,
  paid: 0,
});

// 3台の経路を RIP で動かす（案件の配線に加えて、工場のルーターを本社と倉庫の間の中継にする）
const withRip = (nodes: NetNode[]): NetNode[] =>
  nodes.map((n) => (n.uid.endsWith('_R') ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, rip: true })) } : n));

const net = (solved: boolean): Network => ({
  nodes: solved ? withRip(fixedNodes(contract)) : fixedNodes(contract),
  links: [
    ...contractLinks(contract),
    ...(solved
      ? [cable('fac_hq', 'HQ_R', 2, 'FAC_R', 1, [[8, 5], [17, 5]]), cable('fac_dc', 'FAC_R', 2, 'DC_R', 2, [[17, 5], [27, 5]])]
      : []),
  ],
  plans: {},
});

describe('案件 rt001: 3つの拠点を RIP でつなぐ', () => {
  it('工場のルーターを中継にして3台で RIP を動かすと合格する（静的経路は使わない）', () => {
    expect(evaluateContract(contract, analyze(net(true), data)).passed).toBe(true);
  });
  it('配線と RIP がないままでは不合格', () => {
    expect(evaluateContract(contract, analyze(net(false), data)).passed).toBe(false);
  });
});
