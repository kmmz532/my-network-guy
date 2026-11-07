// ファイアウォールに静的ルートを置き、直列の構成（ルーター ─ ファイアウォール）で戻りが届くことを確かめる
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping } from './netState';
import type { Iface, NetNode, Network } from './types';

const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], gateway: string | null, routes: NetNode['routes'] = [], rules: NetNode['rules'] = [], x = 0): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway, routes, services: [], ports: [], rules }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });

const build = (fwRoutes: NetNode['routes']): Network => ({
  nodes: [
    n('pa', 'pc_basic', [f(0, '10.0.1.10')], '10.0.1.1', [], [], 0),
    n('r', 'router_basic', [f(0, '10.0.1.1'), f(1, '10.0.12.1')], null, [{ dest: '10.0.2.0', prefix: 24, nextHop: '10.0.12.2' }], [], 1),
    n('fw', 'firewall', [f(0, '10.0.12.2'), f(1, '10.0.2.1')], null, fwRoutes, [{ src: 'any', dst: 'any', service: 'any' }], 2),
    n('pb', 'pc_basic', [f(0, '10.0.2.10')], '10.0.2.1', [], [], 3),
  ],
  links: [l('l0', 'pa', 0, 'r', 0), l('l1', 'r', 1, 'fw', 0), l('l2', 'fw', 1, 'pb', 0)],
  segments: {},
});

describe('ファイアウォールの静的ルート（直列の構成）', () => {
  it('戻りの経路がなければ、ルーターから先へ届かない（ファイアウォールに経路を置く）', () => {
    expect(ping(build([]), gameEnv.engine, 'pa', 'pb').ok).toBe(false);
  });

  it('ファイアウォールに戻りの静的ルートを置くと、両方向に届く', () => {
    const net = build([{ dest: '10.0.1.0', prefix: 24, nextHop: '10.0.12.1' }]);
    expect(ping(net, gameEnv.engine, 'pa', 'pb').ok).toBe(true);
    expect(ping(net, gameEnv.engine, 'pb', 'pa').ok).toBe(true);
  });
});
