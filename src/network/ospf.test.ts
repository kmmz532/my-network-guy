import { describe, expect, it } from 'vitest';
import { duplicateRouterIds, electDr, ospfRouterId } from './ospf';
import { learnedRoutesOf, ospfMismatchesOf, ospfNeighborsOf, warningsOf } from './netState';
import { evaluateGoal } from './goals';
import type { EngineData, Iface, NetLink, NetNode, Network } from './types';

const data: EngineData = { categoryOf: (d) => ({ pc: 'pc', router: 'router', l2: 'l2_switch' })[d] ?? 'unknown', maxLengthOf: () => 30 };
const f = (port: number, ip: string, ospf?: Iface['ospf'], prefix = 24): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...(ospf ? { ospf } : {}) });
const node = (uid: string, device: string, interfaces: Iface[], extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

describe('OSPF のルーター ID', () => {
  it('設定がなければ、OSPF に参加したインターフェースの最大のアドレス。設定があればそれを使う', () => {
    const r = node('r', 'router', [f(0, '10.0.1.1', { area: 0 }), f(1, '10.0.12.1', { area: 0 }), f(2, '192.168.9.1')]);
    expect(ospfRouterId(r)).toBe('10.0.12.1');
    expect(ospfRouterId({ ...r, ospf: { routerId: '1.1.1.1' } })).toBe('1.1.1.1');
  });
  it('同じルーター ID の機器を見つける', () => {
    const a = node('a', 'router', [f(0, '10.0.1.1', { area: 0 })], { ospf: { routerId: '1.1.1.1' } });
    const b = node('b', 'router', [f(0, '10.0.2.1', { area: 0 })], { ospf: { routerId: '1.1.1.1' } });
    expect(duplicateRouterIds([a, b])).toEqual([['a', 'b']]);
  });
});

describe('DR・BDR の選出', () => {
  it('優先度が高い順、同じならルーター ID が大きい順。優先度 0 は選ばれない', () => {
    const m = (uid: string, routerId: string, priority: number) => ({ uid, routerId, priority });
    expect(electDr([m('a', '1.1.1.1', 1), m('b', '2.2.2.2', 1), m('c', '3.3.3.3', 1)])).toEqual({ dr: 'c', bdr: 'b' });
    expect(electDr([m('a', '1.1.1.1', 5), m('b', '2.2.2.2', 1), m('c', '3.3.3.3', 0)])).toEqual({ dr: 'a', bdr: 'b' });
  });
});

// R1・R2・R3 を1台のスイッチにつなぐ（同じネットワーク 10.0.0.0/24）
const shared = (hello3 = 10, p2 = 1): Network => ({
  nodes: [
    node('sw', 'l2', []),
    node('r1', 'router', [f(0, '10.0.0.1', { area: 0 })]),
    node('r2', 'router', [f(0, '10.0.0.2', { area: 0, priority: p2 })]),
    node('r3', 'router', [f(0, '10.0.0.3', { area: 0, hello: hello3 })]),
  ],
  links: [link('l1', 'r1', 0, 'sw', 0), link('l2', 'r2', 0, 'sw', 1), link('l3', 'r3', 0, 'sw', 2)],
  segments: {},
});

describe('OSPF の隣接', () => {
  it('3台が同じネットワークにいると、ルーター ID が大きい R3 が DR、次の R2 が BDR', () => {
    const n = ospfNeighborsOf(shared(), data, 'r1');
    expect(n.find((x) => x.uid === 'r3')?.state).toBe('FULL/DR');
    expect(n.find((x) => x.uid === 'r2')?.state).toBe('FULL/BDR');
    expect(n.find((x) => x.uid === 'r3')?.routerId).toBe('10.0.0.3');
  });
  it('優先度を上げた R2 が DR になる', () => {
    const n = ospfNeighborsOf(shared(10, 100), data, 'r1');
    expect(n.find((x) => x.uid === 'r2')?.state).toBe('FULL/DR');
  });
  it('2台だけのネットワークは FULL/- になる', () => {
    const net: Network = { nodes: [node('a', 'router', [f(0, '10.0.0.1', { area: 0 })]), node('b', 'router', [f(0, '10.0.0.2', { area: 0 })])], links: [link('l', 'a', 0, 'b', 0)], segments: {} };
    expect(ospfNeighborsOf(net, data, 'a')[0].state).toBe('FULL/-');
  });
  it('Hello の間隔が違う相手とは隣接にならず、理由が分かる', () => {
    const net = shared(30);
    expect(ospfNeighborsOf(net, data, 'r1').map((x) => x.uid)).toEqual(['r2']);
    expect(ospfMismatchesOf(net, data, 'r1')).toEqual([expect.objectContaining({ uid: 'r3', mismatch: 'hello' })]);
  });
  it('Hello の間隔が違うと、経路が届かず ospf.no_neighbor になる', () => {
    const o = (hello: number) => ({ area: 0, hello });
    const net: Network = {
      nodes: [
        node('pa', 'pc', [f(0, '10.0.1.10')], { gateway: '10.0.1.1' }),
        node('r1', 'router', [f(0, '10.0.1.1', o(10)), f(1, '10.0.12.1', o(10))]),
        node('r2', 'router', [f(0, '10.0.12.2', o(30)), f(1, '10.0.2.1', o(30))]),
        node('pb', 'pc', [f(0, '10.0.2.10')], { gateway: '10.0.2.1' }),
      ],
      links: [link('a', 'pa', 0, 'r1', 0), link('b', 'r1', 1, 'r2', 0), link('c', 'r2', 1, 'pb', 0)],
      segments: {},
    };
    const r = evaluateGoal({ type: 'ping', from: 'pa', to: 'pb' }, net, data);
    expect(r[0].ok).toBe(false);
    expect(r[0].failure?.reason).toBe('ospf.no_neighbor');
  });
});

describe('既定の経路の配布', () => {
  it('default-information originate を設定した機器へ向かう 0.0.0.0/0 を、ほかのルーターが OSPF で覚える', () => {
    const o = { area: 0 };
    const mk = (originate: boolean): Network => ({
      nodes: [
        node('r1', 'router', [f(0, '10.0.12.1', o)]),
        node('r2', 'router', [f(0, '10.0.12.2', o)], originate ? { ospf: { defaultOriginate: true } } : {}),
      ],
      links: [link('l', 'r1', 0, 'r2', 0)],
      segments: {},
    });
    const routes = (net: Network) => learnedRoutesOf(net, data, 'r1', 'ospf');
    expect(routes(mk(true))).toContainEqual(expect.objectContaining({ dest: '0.0.0.0', prefix: 0, nextHop: '10.0.12.2', protocol: 'ospf' }));
    expect(routes(mk(false)).some((r) => r.prefix === 0)).toBe(false);
  });
});

describe('エリアの間の経路（ABR）', () => {
  // PC1 — R1(エリア1) — R2(ABR: エリア1・0) — R3(エリア0) — PC3
  const abr = (): Network => ({
    nodes: [
      node('pc1', 'pc', [f(0, '10.0.1.10')], { gateway: '10.0.1.1' }),
      node('r1', 'router', [f(0, '10.0.1.1', { area: 1 }), f(1, '10.0.12.1', { area: 1 })]),
      node('r2', 'router', [f(0, '10.0.12.2', { area: 1 }), f(1, '10.0.23.1', { area: 0 })]),
      node('r3', 'router', [f(0, '10.0.23.2', { area: 0 }), f(1, '10.0.3.1', { area: 0 })]),
      node('pc3', 'pc', [f(0, '10.0.3.10')], { gateway: '10.0.3.1' }),
    ],
    links: [link('a', 'pc1', 0, 'r1', 0), link('b', 'r1', 1, 'r2', 0), link('c', 'r2', 1, 'r3', 0), link('d', 'r3', 1, 'pc3', 0)],
    segments: {},
  });
  it('ABR を通して、エリア 1 とエリア 0 の経路が互いに届く', () => {
    expect(evaluateGoal({ type: 'ping', from: 'pc1', to: 'pc3' }, abr(), data)[0].ok).toBe(true);
  });
  it('自分が参加していないエリアの経路は O IA になる（ABR の隣は同じエリアなので O）', () => {
    const r1 = learnedRoutesOf(abr(), data, 'r1', 'ospf');
    expect(r1.find((r) => r.dest === '10.0.3.0')?.interArea).toBe(true);
    expect(r1.find((r) => r.dest === '10.0.23.0')?.interArea).toBe(true);
    const r2 = learnedRoutesOf(abr(), data, 'r2', 'ospf');
    expect(r2.some((r) => r.interArea)).toBe(false);
  });
});

describe('ルーター ID の重複の警告', () => {
  it('同じルーター ID の2台に ospf.duplicate_router_id を出す', () => {
    const net: Network = {
      nodes: [
        node('a', 'router', [f(0, '10.0.0.1', { area: 0 })], { ospf: { routerId: '9.9.9.9' } }),
        node('b', 'router', [f(0, '10.0.0.2', { area: 0 })], { ospf: { routerId: '9.9.9.9' } }),
      ],
      links: [link('l', 'a', 0, 'b', 0)],
      segments: {},
    };
    expect(warningsOf(net)).toEqual([{ id: 'ospf.duplicate_router_id', a: 'a', b: 'b' }]);
  });
});
