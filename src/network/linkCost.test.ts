// 配線の速さから求める経路のコスト（OSPF）と、スパニングツリーの口のコスト
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import { gameEnv } from '../sim/env';
import { learnedRoutesOf } from './query/learnedRoutes';
import { stpCostOfSpeed } from './stp';
import type { Iface, NetLink, NetNode, Network } from './types';

const world = gameEnv.engine;
const node = (uid: string, device: string, interfaces: Iface[], extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: 1, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, cable: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable, a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

type Proto = 'ospf' | 'rip';

// R1 と R2 の近道（直接の配線 1 本）と、R3 を通る遠回り（2 区間）。R2 の先に 10.0.2.0/24 がある。
// 遠回りは口の番号 detour から使う（1 なら 1G の口、4 なら 10G の SFP 口）
const triangle = (proto: Proto, shortcut: string, detour: string, detourPort: number, opts: { reference?: number; cost?: number } = {}): Network => {
  const join = (area = 0, cost?: number) => ({ ospf: { area, ...(cost === undefined ? {} : { cost }) } });
  const f = (port: number, ip: string, cost?: number): Iface => ({ id: `p${port}`, kind: 'port', port, ip, prefix: 24, ...(proto === 'ospf' ? join(0, cost) : { rip: true }) });
  const components = opts.reference === undefined ? {} : { components: { ospf: { referenceBandwidth: opts.reference } } };
  return {
    nodes: [
      node('r1', 'edge_router', [f(0, '10.0.12.1', opts.cost), f(detourPort, '10.0.13.1')], components),
      node('r2', 'edge_router', [f(0, '10.0.12.2'), f(detourPort, '10.0.32.2'), f(3, '10.0.2.1')], components),
      node('r3', 'edge_router', [f(detourPort, '10.0.13.2'), f(detourPort + 1, '10.0.32.1')], components),
    ],
    links: [link('s', shortcut, 'r1', 0, 'r2', 0), link('d1', detour, 'r1', detourPort, 'r3', detourPort), link('d2', detour, 'r3', detourPort + 1, 'r2', detourPort)],
    plans: {},
  };
};
const nextHopTo = (net: Network, proto: Proto) => learnedRoutesOf(analyze(net, world), 'r1', proto).find((r) => r.dest === '10.0.2.0')?.nextHop;
const SHORTCUT = '10.0.12.2';
const DETOUR = '10.0.13.2';

describe('OSPF のコストは、配線の速さから求める', () => {
  it('100M の近道と 1G の 2 区間の遠回りでは、OSPF は遠回り、RIP は近道を選ぶ（基準 1000）', () => {
    expect(nextHopTo(triangle('ospf', 'utp_cat5', 'utp_cat5e', 1, { reference: 1000 }), 'ospf')).toBe(DETOUR);
    expect(nextHopTo(triangle('rip', 'utp_cat5', 'utp_cat5e', 1), 'rip')).toBe(SHORTCUT);
  });

  it('既定の基準（100）では 100M も 1G もコスト 1 なので、ホップの少ない近道を選ぶ', () => {
    expect(nextHopTo(triangle('ospf', 'utp_cat5', 'utp_cat5e', 1), 'ospf')).toBe(SHORTCUT);
  });

  it('既定の基準では 1G と 10G が同じコストで、基準を 10000 にすると 10G が選ばれる', () => {
    expect(nextHopTo(triangle('ospf', 'utp_cat5e', 'fiber_sm', 4), 'ospf')).toBe(SHORTCUT);
    expect(nextHopTo(triangle('ospf', 'utp_cat5e', 'fiber_sm', 4, { reference: 10000 }), 'ospf')).toBe(DETOUR);
  });

  it('ip ospf cost の設定は、速さから求めた値より優先される', () => {
    const state = analyze(triangle('ospf', 'utp_cat5', 'utp_cat5e', 1, { reference: 1000, cost: 1 }), world);
    expect(state.routing.ospfCostOf('r1', 0)).toBe(1);
    expect(nextHopTo(triangle('ospf', 'utp_cat5', 'utp_cat5e', 1, { reference: 1000, cost: 1 }), 'ospf')).toBe(SHORTCUT);
  });

  it('コストは、基準 ÷ 速さの切り捨てで、最小は 1', () => {
    const state = analyze(triangle('ospf', 'utp_cat5', 'utp_cat5e', 1, { reference: 1000 }), world);
    expect(state.routing.ospfCostOf('r1', 0)).toBe(10);
    expect(state.routing.ospfCostOf('r1', 1)).toBe(1);
    expect(analyze(triangle('ospf', 'utp_cat5', 'utp_cat5e', 1), world).routing.ospfCostOf('r1', 0)).toBe(1);
  });
});

describe('スパニングツリーの口のコストは、配線の速さから求める', () => {
  it('速さと口のコストの対応（それ以外の速さは近い行）', () => {
    expect([10, 100, 1000, 10000].map(stpCostOfSpeed)).toEqual([100, 19, 4, 2]);
    expect([1, 2000, 40000].map(stpCostOfSpeed)).toEqual([100, 4, 2]);
  });

  it('遅い配線の口は、ルートへの別の道が速ければブロックされる側になる', () => {
    const sw = (uid: string, serial: number) => node(uid, 'l2_switch_8p', [], { macSerial: serial });
    const net: Network = {
      nodes: [sw('sw1', 1), sw('sw2', 2), sw('sw3', 3)],
      links: [link('a', 'utp_cat5e', 'sw1', 0, 'sw2', 0), link('b', 'utp_cat5', 'sw1', 1, 'sw3', 0), link('c', 'utp_cat5e', 'sw2', 1, 'sw3', 1)],
      plans: {},
    };
    const { l2 } = analyze(net, world);
    expect(l2.stp().root).toBe('sw1');
    expect(l2.isStpBlocked('sw3', 0)).toBe(true);
    expect(l2.isStpBlocked('sw3', 1)).toBe(false);
  });
});
