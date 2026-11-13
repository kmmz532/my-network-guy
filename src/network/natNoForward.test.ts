import { http } from './engine';
import { analyze } from './engine/analyze';
// nat.no_forward（NET.md §6）: 外から NAT のルーターの外の口へ来た通信に、静的 NAT の転送先がない
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const build = (statics: NonNullable<NetNode['statics']>): Network => ({
  nodes: [
    n('ext', 'pc_basic', [f(0, '203.0.113.50')], 0, { gateway: '203.0.113.1' }),
    n('hr', 'home_router', [f(0, '203.0.113.1', 'outside'), f(1, '192.168.1.1', 'inside')], 1, { napt: true, statics }),
    n('srv', 'server_basic', [f(0, '192.168.1.10')], 2, { gateway: '192.168.1.1', services: [{ protocol: 'http', port: 80 }] }),
  ],
  links: [l('l0', 'ext', 0, 'hr', 0), l('l1', 'hr', 1, 'srv', 0)],
  plans: {},
});

describe('nat.no_forward（NET.md §6）', () => {
  it('外から、転送先のない外の口のポートへ来た通信は nat.no_forward', () => {
    const r = http(analyze(build([]), gameEnv.engine), 'ext', 'hr', 80);
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('nat.no_forward');
  });
  it('静的 NAT の転送先があれば、社内のサーバーへ届く', () => {
    expect(http(analyze(build([{ port: 80, insideIp: '192.168.1.10', insidePort: 80 }]), gameEnv.engine), 'ext', 'hr', 80).ok).toBe(true);
  });
});
