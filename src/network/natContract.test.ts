// 案件 n001（NAPT）: ルーターで NAPT を設定すると、社内の PC が回線の先へ届く。NAPT がなければ届かない
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../assets/data/contracts/n001_napt_office.json';
import { gameEnv } from '../sim/env';
import type { Contract } from '../data/schema';
import { evaluateGoal } from './goals';
import type { Iface, NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;
const base = (p: (typeof contract.placed)[number], i: number): NetNode =>
  ({
    uid: p.ref,
    device: p.device,
    macSerial: i + 1,
    ports: [],
    x: p.x,
    y: p.y,
    locked: p.locked,
    configLocked: p.config?.locked ?? false,
    interfaces: (p.config?.interfaces ?? []).map((x) => ({ id: 'eth0', kind: 'port' as const, port: x.port, ip: x.ip, prefix: x.prefix })),
    gateway: p.config?.gateway ?? null,
    ...(p.isp ? { isp: p.isp } : {}),
    routes: [],
    services: [],
  }) as NetNode;
const f = (port: number, ip: string, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(nat ? { nat } : {}) });
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

const solved = (napt: boolean): Network => ({
  nodes: [
    ...contract.placed.map(base),
    { uid: 'r1', device: 'router_basic', macSerial: 50, ports: [], x: 0, y: 0, locked: false, configLocked: false, interfaces: [f(0, '198.51.100.2', 'outside'), f(1, '192.168.1.1', 'inside')], gateway: '198.51.100.1', routes: [], services: [], napt } as NetNode,
    { uid: 'sw', device: 'l2_switch_4p', macSerial: 51, ports: [], x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [] } as NetNode,
  ],
  links: [link('w', 'r1', 0, 'line', 0), link('a', 'r1', 1, 'sw', 0), link('b', 'sw', 1, 'staff_a', 0), link('c', 'sw', 2, 'staff_b', 0)],
  segments: {},
});

describe('案件 n001: 事務所をインターネットへつなぐ', () => {
  it('置いただけでは不合格', () => {
    expect(evaluateGoal(contract.goals[0], analyze({ nodes: contract.placed.map(base), links: [], segments: {} }, data)).every((r) => r.ok)).toBe(false);
  });
  it('NAPT を設定すると合格し、NAPT がなければ不合格（社内のアドレスのまま外へ出る）', () => {
    expect(evaluateGoal(contract.goals[0], analyze(solved(true), data)).every((r) => r.ok)).toBe(true);
    expect(evaluateGoal(contract.goals[0], analyze(solved(false), data)).every((r) => r.ok)).toBe(false);
  });
});
