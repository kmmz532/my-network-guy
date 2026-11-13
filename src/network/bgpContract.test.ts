// 案件 b001（2社の ISP）: 境界ルーターを2つの回線終端へつなぎ、BGP で2本の隣接を作ると合格する。片方の隣接がなければ不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../assets/data/contracts/b001_two_isps.json';
import { gameEnv } from '../sim/env';
import type { Contract } from '../data/schema';
import { evaluateGoal } from './goals';
import type { NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;
const base = (ref: string) => contract.placed.find((p) => p.ref === ref)!;
const node = (ref: string, extra: Partial<NetNode> = {}): NetNode => {
  const p = base(ref);
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
    ...(p.isp ? { isp: p.isp } : {}),
    routes: [],
    services: [],
    ...extra,
  } as NetNode;
};
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const port = (id: string, p: number, ip: string): NetNode['interfaces'][number] => ({ id, kind: 'port', port: p, ip, prefix: 24 });

const solved = (neighborB: boolean): Network => ({
  nodes: [
    node('staff_a'),
    node('staff_b'),
    node('edge', {
      interfaces: [port('g0/0', 0, '192.168.1.1'), port('g0/1', 1, '198.51.100.2'), port('g0/2', 2, '203.0.113.2')],
      bgp: {
        asn: 65100,
        neighbors: [{ ip: '198.51.100.1', remoteAs: 65001 }, ...(neighborB ? [{ ip: '203.0.113.1', remoteAs: 65002 }] : [])],
        networks: [{ dest: '192.168.1.0', prefix: 24 }],
      },
    }),
    { uid: 'sw', device: 'l2_switch_4p', macSerial: 90, ports: [], x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [] } as NetNode,
    node('isp_a'),
    node('isp_b'),
  ],
  links: [
    link('1', 'edge', 0, 'sw', 0),
    link('2', 'sw', 1, 'staff_a', 0),
    link('3', 'sw', 2, 'staff_b', 0),
    link('4', 'edge', 1, 'isp_a', 0),
    link('5', 'edge', 2, 'isp_b', 0),
  ],
  segments: {},
});

describe('案件 b001: 2社の ISP', () => {
  it('置いたままでは不合格', () => {
    const net: Network = { nodes: contract.placed.map((p) => node(p.ref)), links: [], segments: {} };
    expect(contract.goals.flatMap((g) => evaluateGoal(g, analyze(net, data))).some((r) => r.ok)).toBe(false);
  });
  it('2社の ISP と eBGP の隣接を張ると、2つの達成条件を満たす', () => {
    const results = contract.goals.map((g) => evaluateGoal(g, analyze(solved(true), data)).every((r) => r.ok));
    expect(results).toEqual([true, true]);
  });
  it('片方の ISP との隣接がなければ、不合格（隣接が1本、回線の冗長にならない）', () => {
    const results = contract.goals.map((g) => evaluateGoal(g, analyze(solved(false), data)).every((r) => r.ok));
    expect(results[0]).toBe(false);
  });
});
