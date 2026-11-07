// 目標 reach_category（N51b。プリンターの共有）: すべての PC が、そのカテゴリの機器のどれか1台へ届くこと
import { describe, expect, it } from 'vitest';
import { evaluateGoal } from './goals';
import type { EngineData, NetLink, NetNode, Network } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', printer: 'printer', l2_switch: 'l2_switch' })[device] ?? 'unknown',
  maxLengthOf: () => 30,
};

const host = (uid: string, device: string, ip: string): NetNode => ({ ports: [],
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [{ id: "g0/0", kind: "port", port: 0, ip, prefix: 24 }],
  gateway: null,
  routes: [],
  services: [],
});

const link = (uid: string, a: string, b: string, bPort: number): NetLink => ({ paid: 0,
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: 0 },
  b: { node: b, port: bPort },
  path: [
    [0, 0],
    [5, 0],
  ],
});

// PC 2台とプリンター1台を、同じネットワークで1台のスイッチ（hub）につなぐ
const star = (printerLinked: boolean): Network => ({
  nodes: [
    host('pc1', 'pc', '192.168.1.10'),
    host('pc2', 'pc', '192.168.1.11'),
    host('pr', 'printer', '192.168.1.20'),
    { ...host('hub', 'l2_switch', '0.0.0.0'), interfaces: [] },
  ],
  links: [link('l1', 'pc1', 'hub', 0), link('l2', 'pc2', 'hub', 1), ...(printerLinked ? [link('l3', 'pr', 'hub', 2)] : [])],
});

const goal = { type: 'reach_category', category: 'printer' } as const;

describe('reach_category', () => {
  it('すべての PC がプリンターに届けば合格', () => {
    const results = evaluateGoal(goal, star(true), data);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.ok)).toBe(true);
  });

  it('プリンターがつながっていなければ不合格', () => {
    const results = evaluateGoal(goal, star(false), data);
    expect(results.some((r) => !r.ok)).toBe(true);
  });

  it('プリンターがなければ不合格（判定する機器がない）', () => {
    const net = star(true);
    const withoutPrinter: Network = { ...net, nodes: net.nodes.filter((n) => n.device !== 'printer'), links: net.links.filter((l) => l.uid !== 'l3') };
    expect(evaluateGoal(goal, withoutPrinter, data).every((r) => !r.ok)).toBe(true);
  });
});
