// 案件 st001（スイッチの輪）: 3台のスイッチを輪につなぎ、中心のスイッチをルートにすると合格する。輪にしないか、ルートが端なら不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/st001_switch_ring.json';
import { gameEnv } from '../sim/env';
import type { Contract } from '../data/schema';
import { evaluateGoal } from './goals';
import { warningsOf } from './query/warnings';
import { withComponent } from './components';
import type { NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;
const node = (ref: string): NetNode => {
  const p = contract.placed.find((x) => x.ref === ref)!;
  return {
    uid: ref,
    device: p.device,
    macSerial: contract.placed.findIndex((x) => x.ref === ref) + 1,
    ports: [],
    x: p.x,
    y: p.y,
    locked: p.locked,
    configLocked: p.config?.locked ?? false,
    interfaces: (p.config?.interfaces ?? []).map((i, k) => ({ id: `eth${k}`, kind: 'port', port: i.port, ip: i.ip, prefix: i.prefix })),
    gateway: p.config?.gateway ?? null,
    routes: [],
    services: [],
  } as NetNode;
};
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

const build = (ring: boolean, coreRoot: boolean): Network => ({
  nodes: contract.placed.map((p) => (p.ref === 'core' && coreRoot ? withComponent(node(p.ref), 'stp', { priority: 4096 }) : node(p.ref))),
  links: [
    link('1', 'pc_a', 0, 'sw_a', 0),
    link('2', 'pc_b', 0, 'sw_b', 0),
    link('3', 'core', 0, 'sw_a', 1),
    link('4', 'core', 1, 'sw_b', 1),
    ...(ring ? [link('5', 'sw_a', 2, 'sw_b', 2)] : []),
  ],
  plans: {},
});
const allOk = (net: Network) => contract.goals.every((g) => evaluateGoal(g, analyze(net, data)).every((r) => r.ok));

describe('案件 st001', () => {
  it('輪にして中心のスイッチをルートにすると合格する', () => {
    expect(allOk(build(true, true))).toBe(true);
  });
  it('輪にしなければ、ケーブルが1本切れると止まるため不合格', () => {
    expect(allOk(build(false, true))).toBe(false);
  });
  it('既定の優先度のままでは別のスイッチがルートになり不合格。3台の輪はどれも中心のため、警告は出ない', () => {
    const net = build(true, false);
    expect(allOk(net)).toBe(false);
    expect(warningsOf(analyze(net, data)).some((w) => w.id === 'stp.blocked_path')).toBe(false);
  });
});
