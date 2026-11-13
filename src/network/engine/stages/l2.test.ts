// L2 の層: VLAN で分かれるドメイン・スパニングツリーの止まる口・ループの検出
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../../../sim/env';
import type { Iface, NetLink, NetNode, Network, PortConfig } from '../../types';
import { stageL2 } from './l2';
import { stageLinks } from './links';

const world = gameEnv.engine;
const node = (uid: string, device: string, serial: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: serial, x: 0, y: 0, locked: false, configLocked: false, interfaces: [] as Iface[], gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const access = (port: number, vlan: number): PortConfig => ({ port, mode: 'access', vlan });
const layers = (net: Network) => stageL2(net, stageLinks(net, world), net, world);

describe('stageL2', () => {
  it('VLAN が違う口は別のドメインになり、鍵は最も小さい端点になる', () => {
    const net: Network = {
      nodes: [
        node('sw', 'l2_switch_8p', 1, { ports: [access(0, 10), access(1, 10), access(2, 20)] }),
        node('p1', 'pc_basic', 2),
        node('p2', 'pc_basic', 3),
        node('p3', 'pc_basic', 4),
      ],
      links: [link('a', 'p1', 0, 'sw', 0), link('b', 'p2', 0, 'sw', 1), link('c', 'p3', 0, 'sw', 2)],
      segments: {},
    };
    const l2 = layers(net);
    const d10 = l2.domainOf({ node: 'p1', port: 0 });
    expect(d10.members.map((m) => m.node).sort()).toEqual(['p1', 'p2']);
    expect(l2.domainOf({ node: 'p3', port: 0 }).members.map((m) => m.node)).toEqual(['p3']);
    expect(l2.keyOf(d10)).toBe('p1:0');
    expect(l2.keyOf(l2.domainOf({ node: 'p3', port: 0 }))).toBe('p3:0');
  });

  it('スイッチの輪は、スパニングツリーが1つの口を止める', () => {
    const net: Network = {
      nodes: [node('sw1', 'l2_switch_8p', 1), node('sw2', 'l2_switch_8p', 2), node('sw3', 'l2_switch_8p', 3)],
      links: [link('a', 'sw1', 0, 'sw2', 0), link('b', 'sw1', 1, 'sw3', 0), link('c', 'sw2', 1, 'sw3', 1)],
      segments: {},
    };
    const l2 = layers(net);
    expect(l2.stp().root).toBe('sw1');
    expect(l2.isStpBlocked('sw3', 1)).toBe(true);
    expect(l2.isStpBlocked('sw2', 1)).toBe(false);
  });

  it('スパニングツリーのない中継機の輪は、ループとして検出される', () => {
    const net: Network = {
      nodes: [node('ap1', 'access_point', 1), node('ap2', 'access_point', 2), node('ap3', 'access_point', 3)],
      links: [link('a', 'ap1', 0, 'ap2', 0), link('b', 'ap2', 1, 'ap3', 0), link('c', 'ap3', 1, 'ap1', 1)],
      segments: {},
    };
    expect(layers(net).domainOf({ node: 'ap1', port: 0 }).loop).toBeDefined();
  });
});
