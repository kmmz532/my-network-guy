// 口の設定（access・trunk・shutdown）と VLAN の計算（N137）
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping } from './netState';
import type { Network, NetNode, NetLink, PortConfig } from './types';

const node = (uid: string, device: string, ip: string | null, ports: PortConfig[] = [], x = 0): NetNode => ({
  uid,
  device,
  x,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: ip ? [{ id: device.startsWith('pc') ? 'eth0' : 'g0/0', kind: 'port', port: 0, ip, prefix: 24 }] : [],
  gateway: null,
  routes: [],
  services: [],
  ports,
});
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: pa },
  b: { node: b, port: pb },
  path: [[0, 0], [1, 0]],
  paid: 0,
});

// PC（a）—スイッチ1（ポート0）、PC（b）—スイッチ1（ポート1）
const oneSwitch = (cfgA: PortConfig[] = [], cfgB: PortConfig[] = []): Network => ({
  nodes: [node('pa', 'pc_basic', '10.0.0.1', [], 0), node('pb', 'pc_basic', '10.0.0.2', [], 2), node('sw', 'l2_switch_8p', null, [...cfgA, ...cfgB], 1)],
  links: [link('l0', 'pa', 0, 'sw', 0), link('l1', 'pb', 0, 'sw', 1)],
  segments: {},
});

describe('口の設定と VLAN（N137）', () => {
  it('既定（すべて VLAN 1）は、同じサブネットの PC に届く', () => {
    expect(ping(oneSwitch(), gameEnv.engine, 'pa', 'pb').ok).toBe(true);
  });

  it('宛先の口を別の VLAN にすると、同じサブネットでも届かない（VLAN で切り分けられる）', () => {
    const net = oneSwitch([], [{ port: 1, mode: 'access', vlan: 20 }]);
    const r = ping(net, gameEnv.engine, 'pa', 'pb');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('ip.unreachable');
  });

  it('両方の口を同じ VLAN にすると届く', () => {
    const net = oneSwitch([{ port: 0, mode: 'access', vlan: 20 }], [{ port: 1, mode: 'access', vlan: 20 }]);
    expect(ping(net, gameEnv.engine, 'pa', 'pb').ok).toBe(true);
  });

  it('停止している口（shutdown）からは届かない（失敗は port.shutdown）', () => {
    const net = oneSwitch([{ port: 0, mode: 'routed', shutdown: true }]);
    const r = ping(net, gameEnv.engine, 'pa', 'pb');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('port.shutdown');
  });

  it('トランクは、許可された VLAN だけ運ぶ（2台のスイッチの間）', () => {
    const build = (allowed: number[]): Network => ({
      nodes: [
        node('pa', 'pc_basic', '10.0.0.1', [], 0),
        node('pb', 'pc_basic', '10.0.0.2', [], 4),
        node('s1', 'l2_switch_8p', null, [{ port: 0, mode: 'access', vlan: 10 }, { port: 1, mode: 'trunk', allowed, native: 1 }], 1),
        node('s2', 'l2_switch_8p', null, [{ port: 0, mode: 'access', vlan: 10 }, { port: 1, mode: 'trunk', allowed, native: 1 }], 3),
      ],
      links: [link('l0', 'pa', 0, 's1', 0), link('l1', 'pb', 0, 's2', 0), link('t', 's1', 1, 's2', 1)],
      segments: {},
    });
    expect(ping(build([10]), gameEnv.engine, 'pa', 'pb').ok).toBe(true);
    expect(ping(build([20]), gameEnv.engine, 'pa', 'pb').ok).toBe(false);
  });
});
