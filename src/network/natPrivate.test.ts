import { ping } from './engine';
import { analyze } from './engine/analyze';
// nat.private_source（NET.md §6）: 社内のアドレスのまま外の口へ出ると、回線の先で届かない。NAPT があれば届く
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const build = (napt: boolean): Network => ({
  nodes: [
    n('ext', 'pc_basic', [f(0, '203.0.113.50')], 0, { gateway: '203.0.113.1' }),
    n('hr', 'home_router', [f(0, '203.0.113.1', 'outside'), f(1, '192.168.1.1', 'inside')], 1, { napt }),
    n('pc', 'pc_basic', [f(0, '192.168.1.10')], 2, { gateway: '192.168.1.1' }),
  ],
  links: [l('l0', 'ext', 0, 'hr', 0), l('l1', 'hr', 1, 'pc', 0)],
  plans: {},
});

describe('nat.private_source（NET.md §6）', () => {
  it('NAPT がなければ、社内の PC は外へ届かない（nat.private_source）', () => {
    const r = ping(analyze(build(false), gameEnv.engine), 'pc', 'ext');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('nat.private_source');
  });
  it('NAPT があれば、外へ届く', () => {
    expect(ping(analyze(build(true), gameEnv.engine), 'pc', 'ext').ok).toBe(true);
  });
});
