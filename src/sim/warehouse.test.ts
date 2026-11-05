import { describe, expect, it } from 'vitest';
import type { ShopItem } from '../data/schema';
import { warehouseItems, warehouseMode } from './warehouse';

const shop = [
  { device: 'pc_basic', unlock: null },
  { device: 'l2_switch_8p', unlock: { contract: 'c001_direct_link' } },
  { furniture: 'plant', unlock: null },
  { furniture: 'sofa', unlock: { contract: 'c002_small_office' } },
] as unknown as ShopItem[];

describe('倉庫の画面の状態', () => {
  it('案件がなければ自社オフィス、設計中は設計、施工中と納品の結果は閉じる', () => {
    expect(warehouseMode(null, false)).toBe('office');
    expect(warehouseMode('design', false)).toBe('design');
    expect(warehouseMode('build', false)).toBe('closed');
    expect(warehouseMode(null, true)).toBe('closed');
  });
});

describe('倉庫の欄に並べる品目', () => {
  const owned = { pc_basic: 2, l2_switch_8p: 1, plant: 1, sofa: 3 };

  it('自社オフィスでは、機材と家具の在庫を並べる', () => {
    expect(warehouseItems('office', shop, ['c001_direct_link', 'c002_small_office'], owned)).toEqual([
      { kind: 'device', id: 'pc_basic' },
      { kind: 'device', id: 'l2_switch_8p' },
      { kind: 'furniture', id: 'plant' },
      { kind: 'furniture', id: 'sofa' },
    ]);
  });

  it('案件の設計中は、機材だけを並べる', () => {
    expect(warehouseItems('design', shop, ['c001_direct_link', 'c002_small_office'], owned)).toEqual([
      { kind: 'device', id: 'pc_basic' },
      { kind: 'device', id: 'l2_switch_8p' },
    ]);
  });

  it('施工中と納品の結果では、何も並べない', () => {
    expect(warehouseItems('closed', shop, ['c001_direct_link'], owned)).toEqual([]);
  });

  it('在庫が0の品目と、まだ解禁されていない品目は並べない', () => {
    expect(warehouseItems('office', shop, [], { pc_basic: 0, plant: 1, sofa: 3 })).toEqual([{ kind: 'furniture', id: 'plant' }]);
  });
});
