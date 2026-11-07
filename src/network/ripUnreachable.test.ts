// rip.unreachable（N141b・NET.md §6）: RIP に参加していて、経路がない（16 ホップ以上で届かない）ときの失敗
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping } from './netState';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string, rip = false): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(rip ? { rip: true } : {}) });
const n = (uid: string, interfaces: Iface[], x: number): NetNode =>
  ({ uid, device: uid.startsWith('p') ? 'pc_basic' : 'router_basic', x, y: 0, locked: false, configLocked: false, interfaces, gateway: uid.startsWith('p') ? interfaces[0].ip.replace(/\.\d+$/, '.1') : null, routes: [], services: [], ports: [] }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// PC A — R1 — （RIP に参加しない）— R2 — PC B。R1 の RIP の口は、R2 とは同じ RIP の隣接でないため、経路を覚えない
const net = (): Network => ({
  nodes: [
    n('pa', [f(0, '10.0.1.10')], 0),
    n('r1', [f(0, '10.0.1.1', true), f(1, '10.0.12.1', true)], 1),
    n('r2', [f(0, '10.0.12.2'), f(1, '10.0.2.1', true)], 2),
    n('pb', [f(0, '10.0.2.10')], 3),
  ],
  links: [l('l0', 'pa', 0, 'r1', 0), l('l1', 'r1', 1, 'r2', 0), l('l2', 'r2', 1, 'pb', 0)],
  segments: {},
});

describe('rip.unreachable（N141b）', () => {
  it('RIP の経路がなく届かないときは rip.unreachable を返す', () => {
    const r = ping(net(), gameEnv.engine, 'pa', 'pb');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('rip.unreachable');
  });
});
