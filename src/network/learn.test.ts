// 通信で覚えること（N69）。ping が通ったときの ARP と MAC の学習
import { describe, expect, it } from 'vitest';
import { macOf } from './mac';
import { learnFromPing } from './learn';
import type { EngineData, NetLink, NetNode } from './types';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', l2: 'l2_switch', rt: 'router' })[device] ?? 'unknown',
  maxLengthOf: () => 30,
};
const host = (uid: string, ip: string, serial: number, extra: Partial<NetNode> = {}): NetNode => ({
  uid,
  device: 'pc',
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [{ id: "g0/0", kind: "port", port: 0, ip, prefix: 24 }],
  gateway: null,
  routes: [],
  services: [],
  macSerial: serial,
  ...extra,
});
const sw: NetNode = { ...host('s', '0.0.0.0', 9), device: 'l2', interfaces: [], macSerial: 9 };
const link = (uid: string, a: string, ap: number, b: string, bp: number): NetLink => ({ paid: 0,
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: ap },
  b: { node: b, port: bp },
  path: [
    [0, 0],
    [5, 0],
  ],
});

describe('通信で覚えること（N69）', () => {
  it('同じネットワークの相手は、ARP の表に相手の IPアドレスと MAC を加える', () => {
    const nodes = [host('a', '192.168.1.10', 1), host('b', '192.168.1.11', 2), sw];
    const links = [link('l1', 'a', 0, 's', 0), link('l2', 'b', 0, 's', 1)];
    const r = learnFromPing(nodes, links, data, 'a', 'b');
    expect(r.arp).toEqual({ ip: '192.168.1.11', mac: macOf('pc', 2, 0) });
    expect(r.macs).toEqual([
      { switchUid: 's', entry: { mac: macOf('pc', 1, 0), port: 0 } },
      { switchUid: 's', entry: { mac: macOf('pc', 2, 0), port: 1 } },
    ]);
  });

  it('届かない通信は、何も覚えない', () => {
    const nodes = [host('a', '192.168.1.10', 1), host('b', '192.168.1.11', 2), sw];
    const links = [link('l1', 'a', 0, 's', 0)];
    expect(learnFromPing(nodes, links, data, 'a', 'b')).toEqual({ arp: null, macs: [] });
  });

  it('別のネットワークの相手は、既定のゲートウェイを ARP に加える', () => {
    // 経路: a — s — r（192.168.1.1 と 10.0.0.1 の2つのポート） — c
    const router = host('r', '192.168.1.1', 3, {
      device: 'rt',
      interfaces: [
        { id: "g0/0", kind: "port", port: 0, ip: '192.168.1.1', prefix: 24 },
        { id: "g0/1", kind: "port", port: 1, ip: '10.0.0.1', prefix: 24 },
      ],
    });
    const far = host('c', '10.0.0.5', 4, { gateway: '10.0.0.1' });
    const src = host('a', '192.168.1.10', 1, { gateway: '192.168.1.1' });
    const nodes = [src, router, far, sw];
    const links = [link('l1', 'a', 0, 's', 0), link('l2', 'r', 0, 's', 1), link('l3', 'c', 0, 'r', 1)];
    const r = learnFromPing(nodes, links, data, 'a', 'c');
    expect(r.arp).toEqual({ ip: '192.168.1.1', mac: macOf('router', 3, 0) });
  });
});
