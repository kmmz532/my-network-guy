// 警告（NET.md §6）: 通るが直すべき VLAN の設定（直結の両端の access の VLAN の違い・trunk の native の違い）
import { describe, expect, it } from 'vitest';
import { warningsOf } from './netState';
import type { NetLink, NetNode, Network, PortConfig } from './types';

const sw = (uid: string, ports: PortConfig[]): NetNode => ({ uid, device: 'l2_switch_8p', x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports }) as NetNode;
const net = (a: PortConfig, b: PortConfig): Network => {
  const links: NetLink[] = [{ uid: 'l', cable: 'utp_cat5e', a: { node: 'a', port: a.port }, b: { node: 'b', port: b.port }, path: [[0, 0], [1, 0]], paid: 0 }];
  return { nodes: [sw('a', [a]), sw('b', [b])], links, segments: {} };
};

describe('警告（VLAN）', () => {
  it('直結の両端の access の VLAN が違えば、vlan.mismatch', () => {
    const w = warningsOf(net({ port: 0, mode: 'access', vlan: 10 }, { port: 0, mode: 'access', vlan: 20 }));
    expect(w).toEqual([{ id: 'vlan.mismatch', a: 'a', b: 'b' }]);
  });
  it('同じ VLAN の access は、警告を出さない', () => {
    expect(warningsOf(net({ port: 0, mode: 'access', vlan: 10 }, { port: 0, mode: 'access', vlan: 10 }))).toEqual([]);
  });
  it('両端の trunk の native が違えば、vlan.native_mismatch', () => {
    const w = warningsOf(net({ port: 0, mode: 'trunk', native: 1 }, { port: 0, mode: 'trunk', native: 99 }));
    expect(w).toEqual([{ id: 'vlan.native_mismatch', a: 'a', b: 'b' }]);
  });
});
