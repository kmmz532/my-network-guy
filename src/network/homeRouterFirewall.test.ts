import { ping } from './engine';
import { analyze } from './engine/analyze';
// 家庭用ルーターの既定の規則: 外から始まる通信は止める。社内から始まった通信の戻りは通る（NET.md §4）
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], gateway: string | null, x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway, routes: [], services: [], ports: [], ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// 外の PC（203.0.113.50）— 家庭用ルーターの WAN（口0）・LAN（口1）— 社内の PC（192.168.1.10）
const home = (): Network => ({
  nodes: [
    n('ext', 'pc_basic', [f(0, '203.0.113.50')], '203.0.113.1', 0),
    n('hr', 'home_router', [f(0, '203.0.113.1', 'outside'), f(1, '192.168.1.1', 'inside')], null, 1, { napt: true }),
    n('pc', 'pc_basic', [f(0, '192.168.1.10')], '192.168.1.1', 2),
  ],
  links: [l('l0', 'ext', 0, 'hr', 0), l('l1', 'hr', 1, 'pc', 0)],
  plans: {},
});

describe('家庭用ルーターの既定の規則（外から始まる通信）', () => {
  it('外から社内の PC へ始まる通信は止まる（既定は拒否）', () => {
    const r = ping(analyze(home(), gameEnv.engine), 'ext', 'pc');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('firewall.denied');
  });

  it('社内の PC から外へ始まった通信は通る（戻りも通る）', () => {
    expect(ping(analyze(home(), gameEnv.engine), 'pc', 'ext').ok).toBe(true);
  });
});
