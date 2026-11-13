import { ping } from './engine';
import { analyze } from './engine/analyze';
// OSPF の失敗 ospf.no_neighbor（N142）: OSPF に参加しているのに、隣接がなくて宛先の経路がない
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...extra });
const n = (uid: string, interfaces: Iface[], x: number): NetNode =>
  ({ uid, device: uid.startsWith('p') ? 'pc_basic' : 'router_basic', x, y: 0, locked: false, configLocked: false, interfaces, gateway: uid.startsWith('p') ? interfaces[0].ip.replace(/\.\d+$/, '.1') : null, routes: [], services: [], ports: [] }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// PC A — R1 — （隣接しない）— R2 — PC B。R1 の中継の口は OSPF に参加しているが、R2 とは同じサブネットでない
const build = (): Network => ({
  nodes: [
    n('pa', [f(0, '10.0.1.10')], 0),
    n('r1', [f(0, '10.0.1.1', { ospf: { area: 0 } }), f(1, '10.0.12.1', { ospf: { area: 0 } })], 1),
    n('r2', [f(0, '10.0.99.2', { ospf: { area: 0 } }), f(1, '10.0.2.1', { ospf: { area: 0 } })], 2),
    n('pb', [f(0, '10.0.2.10')], 3),
  ],
  links: [l('l0', 'pa', 0, 'r1', 0), l('l1', 'r1', 1, 'r2', 0), l('l2', 'r2', 1, 'pb', 0)],
  segments: {},
});

describe('ospf.no_neighbor（N142）', () => {
  it('隣接がなく宛先の経路がないとき、route.none ではなく ospf.no_neighbor を返す', () => {
    const r = ping(analyze(build(), gameEnv.engine), 'pa', 'pb');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('ospf.no_neighbor');
  });
});
