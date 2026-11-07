// NAPT（N145）: 社内から外へ出る通信の送信元を外の口のアドレスに変え、戻りを社内へ戻す
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping } from './netState';
import type { Iface, NetNode, Network } from './types';

const f = (port: number, ip: string, nat?: 'inside' | 'outside', prefix = 24): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], gateway: string | null, routes: NetNode['routes'] = [], napt = false, x = 0): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway, routes, services: [], ports: [], ...(napt ? { napt: true } : {}) }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });

// PC(192.168.1.10) — R(LAN 192.168.1.1・WAN 198.51.100.2) — インターネット(198.51.100.1)
const build = (napt: boolean): Network => ({
  nodes: [
    n('pc', 'pc_basic', [f(0, '192.168.1.10')], '192.168.1.1', [], false, 0),
    n('r', 'router_basic', [f(0, '198.51.100.2', 'outside'), f(1, '192.168.1.1', 'inside')], null, [{ dest: '0.0.0.0', prefix: 0, nextHop: '198.51.100.1' }], napt, 1),
    n('net', 'internet', [f(0, '198.51.100.1')], null, [], false, 2),
  ],
  links: [l('l0', 'pc', 0, 'r', 1), l('l1', 'r', 0, 'net', 0)],
  segments: {},
});

describe('NAPT（N145）', () => {
  it('NAPT があれば、社内の PC から外へ届き、戻りも社内へ戻る', () => {
    const r = ping(build(true), gameEnv.engine, 'pc', 'net');
    expect(r.ok).toBe(true);
    expect(r.nat).toEqual({ router: 'r', insideIp: '192.168.1.10', outsideIp: '198.51.100.2' });
  });

  it('NAPT がなければ、社内のアドレスのまま外へ出て届かない（nat.private_source。NET.md §6）', () => {
    const r = ping(build(false), gameEnv.engine, 'pc', 'net');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('nat.private_source');
  });
});
