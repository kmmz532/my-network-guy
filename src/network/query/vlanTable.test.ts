// VLAN の一覧。設定のない口は VLAN 1、トランクは許可の一覧の VLAN を通し、一覧がなければすべてを通す
import { describe, expect, it } from 'vitest';
import type { NetNode } from '../types';
import { vlanTableOf } from './vlanTable';

const sw = (ports: NetNode['ports'], vlanDefs?: { id: number; name?: string }[]): NetNode =>
  ({ uid: 'sw', device: 'l2_switch_8p', x: 0, y: 0, interfaces: [], ports, services: [], gateway: null, components: vlanDefs ? { vlanDefs } : undefined }) as unknown as NetNode;

describe('vlanTableOf', () => {
  it('アクセスの口は設定の VLAN に、設定のない口は VLAN 1 に属し、名前は宣言から付く', () => {
    const rows = vlanTableOf(sw([{ port: 0, mode: 'access', vlan: 10 }, { port: 1, mode: 'access', vlan: 20 }], [{ id: 10, name: 'eigyo' }]), 4);
    expect(rows.map((r) => [r.id, r.name, r.access])).toEqual([
      [1, null, [2, 3]],
      [10, 'eigyo', [0]],
      [20, null, [1]],
    ]);
  });

  it('トランクの口は、許可の一覧の VLAN だけに、一覧がなければすべての VLAN に入る', () => {
    const rows = vlanTableOf(sw([{ port: 0, mode: 'access', vlan: 10 }, { port: 2, mode: 'trunk', allowed: [10] }, { port: 3, mode: 'trunk' }]), 4);
    expect(rows.find((r) => r.id === 10)?.trunk).toEqual([2, 3]);
    expect(rows.find((r) => r.id === 1)?.trunk).toEqual([3]);
  });
});
