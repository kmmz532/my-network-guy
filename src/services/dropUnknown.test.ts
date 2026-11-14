// 登録にない機器を、セーブから取り除く試験
import { describe, expect, it } from 'vitest';
import type { NetLink, NetNode } from '../network/types';
import type { Company } from '../company/company';
import { registries } from '../registry/game';
import type { Office } from '../sim/project';
import { dropUnknownDevices, dropUnknownFromOffice } from './dropUnknown';

const node = (uid: string, device: string): NetNode => ({ uid, device, x: 0, y: 0, ports: [] } as unknown as NetNode);
const link = (uid: string, a: string, b: string): NetLink => ({ uid, cable: registries.cables.all()[0].id, a: { node: a, port: 0 }, b: { node: b, port: 0 } } as unknown as NetLink);

// 必要な項目だけを持つセーブ（残りは試験に関係しない）
const saveOf = (over: Partial<Pick<Company, 'owned' | 'office' | 'active'>>): Company =>
  ({ owned: {}, office: { nodes: [], links: [], furniture: [], seq: 0 }, active: [], familiarity: { counts: {}, blueprints: {} }, offers: [], ...over }) as unknown as Company;

describe('登録にない機器の取り除き', () => {
  it('既知の機器だけのセーブは、同じ参照を返す', () => {
    const data = saveOf({ owned: { pc_basic: 2 }, office: { nodes: [node('a', 'pc_basic')], links: [], furniture: [], seq: 1 } as unknown as Company['office'] });
    const r = dropUnknownDevices(data);
    expect(r.data).toBe(data);
    expect(r.dropped).toEqual([]);
    expect(r.count).toBe(0);
  });

  it('未知の機器と、その機器につながる配線を取り除き、ID を dropped に入れる', () => {
    const data = saveOf({
      office: { nodes: [node('a', 'pc_basic'), node('g', 'ghost_device')], links: [link('l1', 'a', 'g')], furniture: [], seq: 2 } as unknown as Company['office'],
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
    const project = { id: 'p1', nodes: [node('g', 'ghost_device')], links: [], contract: { placed: [] } } as unknown as Company['active'][number];
    const r = dropUnknownDevices(saveOf({ active: [project] }));
    expect(r.data.active[0].nodes).toEqual([]);
    expect(r.dropped).toEqual(['ghost_device']);
    expect(r.count).toBe(1);
  });

  it('型紙の機器と配線、依頼と案件の契約の配置する機器も、未知のものを取り除く', () => {
    const design = { nodes: [node('a', 'pc_basic'), node('g', 'ghost_device')], links: [link('l1', 'a', 'g')], plans: {} };
    const data = {
      ...saveOf({ active: [{ id: 'p1', nodes: [], links: [], contract: { placed: [{ ref: 'r', device: 'ghost_device' }, { ref: 'q', device: 'pc_basic' }] } } as unknown as Company['active'][number]] }),
      familiarity: { counts: {}, blueprints: { k: { stars: 2, design } } },
      offers: [{ id: 'o1', contract: { placed: [{ ref: 'r', device: 'ghost_device' }] } }],
    } as unknown as Company;
    const r = dropUnknownDevices(data);
    expect(r.data.familiarity.blueprints.k.design.nodes.map((n) => n.uid)).toEqual(['a']);
    expect(r.data.familiarity.blueprints.k.design.links).toEqual([]);
    expect(r.data.active[0].contract.placed.map((x) => x.device)).toEqual(['pc_basic']);
    expect((r.data.offers[0] as { contract: { placed: unknown[] } }).contract.placed).toEqual([]);
    expect(r.dropped).toEqual(['ghost_device']);
  });

  it('未知のケーブルの配線と未知の家具を取り除き、ID を dropped に入れる', () => {
    const cable = registries.cables.all()[0].id;
    const desk = registries.furniture.all()[0].id;
    const withCable = (uid: string, cableId: string, a: string, b: string): NetLink => ({ ...link(uid, a, b), cable: cableId } as NetLink);
    const data = saveOf({
      office: {
        nodes: [node('a', 'pc_basic'), node('b', 'pc_basic')],
        links: [withCable('l1', cable, 'a', 'b'), withCable('l2', 'ghost_cable', 'a', 'b')],
        furniture: [{ uid: 'f1', id: desk, x: 0, y: 0 }, { uid: 'f2', id: 'ghost_furniture', x: 1, y: 1 }],
        seq: 2,
      } as unknown as Company['office'],
    });
    const r = dropUnknownDevices(data);
    expect(r.data.office.links.map((l) => l.uid)).toEqual(['l1']);
    expect(r.data.office.furniture.map((f) => f.uid)).toEqual(['f1']);
    expect(r.dropped.sort()).toEqual(['ghost_cable', 'ghost_furniture']);
    expect(r.count).toBe(2);
  });

  it('構成のファイルの読み込みと同じ関数も、未知のケーブル・家具を取り除く', () => {
    const office = { nodes: [], links: [], furniture: [{ uid: 'f2', id: 'ghost_furniture', x: 1, y: 1 }] } as unknown as Office;
    const r = dropUnknownFromOffice(office);
    expect(r.office.furniture).toEqual([]);
    expect(r.count).toBe(1);
  });
});
