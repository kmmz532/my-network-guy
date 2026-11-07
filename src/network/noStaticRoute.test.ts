// 目標 no_static_route（N143）: すべての PC どうしが届き、設定した経路（static）がない
import { describe, expect, it } from 'vitest';
import { evaluateGoal } from './goals';
import type { EngineData, NetLink, NetNode, Network, Route } from './types';

const data: EngineData = { categoryOf: (d) => ({ pc: 'pc', router: 'router' })[d] ?? 'unknown', maxLengthOf: () => 30 };
const iface = (port: number, ip: string, ospf = false) => ({ id: `g0/${port}`, kind: 'port' as const, port, ip, prefix: 24, ...(ospf ? { ospf: { area: 0 } } : {}) });
const node = (uid: string, device: string, interfaces: NetNode['interfaces'], routes: Route[] = [], gateway: string | null = null, x = 0): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway, routes, services: [], ports: [] }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// PC A — R1 — R2 — PC B。R1・R2 は OSPF で経路を覚える（static なし）
const net = (staticRoute: boolean): Network => ({
  nodes: [
    node('pa', 'pc', [iface(0, '10.0.1.10')], [], '10.0.1.1', 0),
    node('r1', 'router', [iface(0, '10.0.1.1', true), iface(1, '10.0.12.1', true)], staticRoute ? [{ dest: '10.0.2.0', prefix: 24, nextHop: '10.0.12.2' }] : [], null, 1),
    node('r2', 'router', [iface(0, '10.0.12.2', true), iface(1, '10.0.2.1', true)], [], null, 2),
    node('pb', 'pc', [iface(0, '10.0.2.10')], [], '10.0.2.1', 3),
  ],
  links: [link('l0', 'pa', 0, 'r1', 0), link('l1', 'r1', 1, 'r2', 0), link('l2', 'r2', 1, 'pb', 0)],
  segments: {},
});

describe('no_static_route（N143）', () => {
  it('経路が動的（OSPF）で、PC どうしが届けば合格', () => {
    expect(evaluateGoal({ type: 'no_static_route' }, net(false), data).every((r) => r.ok)).toBe(true);
  });
  it('設定した経路（static）があれば不合格', () => {
    expect(evaluateGoal({ type: 'no_static_route' }, net(true), data).every((r) => r.ok)).toBe(false);
  });
});
