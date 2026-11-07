// 家庭用ルーター（N-家庭用ルーター）: LAN の口は内蔵スイッチとして1つのセグメントになる。VLAN は使わない
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping } from './netState';
import { isFabricPort, isRelayPort } from './category';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], x: number): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [] }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// 家庭用ルーターの LAN の口（1 と 2）に、同じ LAN の PC を2台つなぐ
const lan = (): Network => ({
  nodes: [
    n('hr', 'home_router', [f(1, '192.168.1.1')], 1),
    n('pc1', 'pc_basic', [f(0, '192.168.1.10')], 0),
    n('pc2', 'pc_basic', [f(0, '192.168.1.20')], 2),
  ],
  links: [l('l0', 'pc1', 0, 'hr', 1), l('l1', 'pc2', 0, 'hr', 2)],
  segments: {},
});

describe('家庭用ルーターの内蔵スイッチ', () => {
  it('LAN の口どうしは、内蔵スイッチとして1つの LAN になり届く（VLAN なし）', () => {
    expect(ping(lan(), gameEnv.engine, 'pc1', 'pc2').ok).toBe(true);
    expect(ping(lan(), gameEnv.engine, 'pc2', 'pc1').ok).toBe(true);
  });

  it('WAN の口（0）は内蔵スイッチの中継ではない', () => {
    expect(isFabricPort('home_router', 0)).toBe(false);
    expect(isFabricPort('home_router', 1)).toBe(true);
    expect(isRelayPort('home_router', 1)).toBe(false);
  });
});
