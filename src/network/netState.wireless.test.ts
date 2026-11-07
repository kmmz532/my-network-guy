// 電波の範囲（N151）: 範囲の中の無線の端末は、最も近いアクセスポイントの LAN に入る
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping, WIRELESS_RADIUS } from './netState';
import type { Iface, NetNode, Network } from './types';

const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], gateway: string | null, x: number, y = 0, wireless?: NetNode['wireless']): NetNode =>
  ({ uid, device, x, y, locked: false, configLocked: false, interfaces, gateway, routes: [], services: [], ports: [], ...(wireless ? { wireless } : {}) }) as NetNode;
const WIFI = { ssid: 'home', password: 'pass1234' };
const l = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });

// 有線の PC（LAN 192.168.1.10）— L2 スイッチ — アクセスポイント（有線の口0）。ノート PC は電波で届く
const build = (laptopX: number): Network => ({
  nodes: [
    n('pc', 'pc_basic', [f(0, '192.168.1.10')], '192.168.1.1', 0),
    n('sw', 'l2_switch_8p', [], null, 1),
    n('ap', 'access_point', [], null, 2, 0, WIFI),
    n('lap', 'laptop', [f(0, '192.168.1.20')], '192.168.1.1', laptopX, 0, WIFI),
  ],
  links: [l('l0', 'pc', 0, 'sw', 0), l('l1', 'sw', 1, 'ap', 0)],
  segments: {},
});

describe('電波の範囲（N151）', () => {
  it('範囲の中のノート PC は、アクセスポイントの LAN に入り、有線の PC と届く', () => {
    expect(ping(build(2 + 3), gameEnv.engine, 'pc', 'lap').ok).toBe(true);
    expect(ping(build(2 + 3), gameEnv.engine, 'lap', 'pc').ok).toBe(true);
  });

  it('パスワードが違う端末は、アクセスポイントにつながらず届かない', () => {
    const net = build(2 + 3);
    const wrong = { ...net, nodes: net.nodes.map((x) => (x.uid === 'lap' ? { ...x, wireless: { ssid: 'home', password: 'wrong' } } : x)) };
    expect(ping(wrong, gameEnv.engine, 'pc', 'lap').ok).toBe(false);
  });

  it('範囲の外のノート PC は、LAN に入らず届かない', () => {
    expect(ping(build(2 + WIRELESS_RADIUS + 5), gameEnv.engine, 'pc', 'lap').ok).toBe(false);
  });
});
