// 登録にない機器を、セーブから取り除く試験
import { describe, expect, it } from 'vitest';
import type { NetLink, NetNode } from '../network/types';
import type { SaveData } from './migrations';
import { dropUnknownDevices } from './dropUnknown';

const node = (uid: string, device: string): NetNode => ({ uid, device, x: 0, y: 0, ports: [] } as unknown as NetNode);
const link = (uid: string, a: string, b: string): NetLink => ({ uid, a: { node: a, port: 0 }, b: { node: b, port: 0 } } as unknown as NetLink);

// 必要な項目だけを持つセーブ（残りは試験に関係しない）
const saveOf = (over: Partial<Pick<SaveData, 'owned' | 'office' | 'active'>>): SaveData =>
  ({ owned: {}, office: { nodes: [], links: [], seq: 0 }, active: [], ...over }) as unknown as SaveData;

describe('登録にない機器の取り除き', () => {
  it('既知の機器だけのセーブは、同じ参照を返す', () => {
    const data = saveOf({ owned: { pc_basic: 2 }, office: { nodes: [node('a', 'pc_basic')], links: [], seq: 1 } as unknown as SaveData['office'] });
    const r = dropUnknownDevices(data);
    expect(r.data).toBe(data);
    expect(r.dropped).toEqual([]);
    expect(r.count).toBe(0);
  });

  it('未知の機器と、その機器につながる配線を取り除き、ID を dropped に入れる', () => {
    const data = saveOf({
      office: { nodes: [node('a', 'pc_basic'), node('g', 'ghost_device')], links: [link('l1', 'a', 'g')], seq: 2 } as unknown as SaveData['office'],
    });
    const r = dropUnknownDevices(data);
    expect(r.data.office.nodes.map((n) => n.uid)).toEqual(['a']);
    expect(r.data.office.links).toEqual([]);
    expect(r.dropped).toEqual(['ghost_device']);
    expect(r.count).toBe(1);
  });

  it('未知の機材の在庫を取り除き、個数を count に足す', () => {
    const data = saveOf({ owned: { pc_basic: 1, ghost_device: 3 } });
    const r = dropUnknownDevices(data);
    expect(r.data.owned).toEqual({ pc_basic: 1 });
    expect(r.dropped).toEqual(['ghost_device']);
    expect(r.count).toBe(3);
  });

  it('各案件の機器も同じように取り除く', () => {
    const project = { id: 'p1', nodes: [node('g', 'ghost_device')], links: [] } as unknown as SaveData['active'][number];
    const r = dropUnknownDevices(saveOf({ active: [project] }));
    expect(r.data.active[0].nodes).toEqual([]);
    expect(r.dropped).toEqual(['ghost_device']);
    expect(r.count).toBe(1);
  });
});
