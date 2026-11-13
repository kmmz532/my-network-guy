import { ping } from './engine';
import { analyze } from './engine/analyze';
// SVI（VLAN のインターフェース・N138）: L3スイッチの access の口を VLAN ごとに分け、SVI で VLAN の間を中継する
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { makeSvi } from './iface';
import type { Iface, NetLink, NetNode, Network } from './types';

const f = (port: number, ip: string, prefix = 24): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix });
const pc = (uid: string, ip: string, gateway: string): NetNode =>
  ({ uid, device: 'pc_basic', x: 0, y: 0, locked: false, configLocked: false, interfaces: [f(0, ip)], gateway, routes: [], services: [], ports: [] }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 }) as NetLink;

// PC1・PC2 は VLAN 10、PC3 は VLAN 20。L3スイッチの口0・1が VLAN 10、口2が VLAN 20
const build = (svi: boolean): Network => {
  const l3: NetNode = {
    uid: 'l3',
    device: 'l3_switch',
    x: 1,
    y: 0,
    locked: false,
    configLocked: false,
    gateway: null,
    routes: [],
    services: [],
    interfaces: svi ? [makeSvi(10, '192.168.10.1', 24), makeSvi(20, '192.168.20.1', 24)] : [],
    ports: [
      { port: 0, mode: 'access', vlan: 10 },
      { port: 1, mode: 'access', vlan: 10 },
      { port: 2, mode: 'access', vlan: 20 },
    ],
  } as NetNode;
  return {
    nodes: [pc('pc1', '192.168.10.10', '192.168.10.1'), pc('pc2', '192.168.10.11', '192.168.10.1'), pc('pc3', '192.168.20.10', '192.168.20.1'), l3],
    links: [link('l1', 'pc1', 0, 'l3', 0), link('l2', 'pc2', 0, 'l3', 1), link('l3x', 'pc3', 0, 'l3', 2)],
    plans: {},
  };
};

describe('SVI（N138 の段1・段2）', () => {
  it('同じ VLAN の PC どうしは、SVI がなくても届く', () => {
    expect(ping(analyze(build(false), gameEnv.engine), 'pc1', 'pc2').ok).toBe(true);
  });

  it('SVI があれば、VLAN の違う PC へ届く（SVI が VLAN 間の中継になる）', () => {
    expect(ping(analyze(build(true), gameEnv.engine), 'pc1', 'pc3').ok).toBe(true);
  });

  it('SVI がなければ、VLAN の違う PC へは届かない', () => {
    expect(ping(analyze(build(false), gameEnv.engine), 'pc1', 'pc3').ok).toBe(false);
  });
});
