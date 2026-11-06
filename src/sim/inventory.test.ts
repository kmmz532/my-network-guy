import { describe, expect, it } from 'vitest';
import { inventoryItems, inventoryMode } from './inventory';

describe('インベントリの画面の状態', () => {
  it('案件がなければ自社オフィス、設計中は設計、施工中と納品の結果は閉じる', () => {
    expect(inventoryMode(null, false)).toBe('office');
    expect(inventoryMode('design', false)).toBe('design');
    expect(inventoryMode('build', false)).toBe('closed');
    expect(inventoryMode(null, true)).toBe('closed');
  });
});

describe('インベントリの欄に並べる品目（B1）', () => {
  // 店で未解放の機器 l3_switch も、持っていれば並ぶ。店の並び順は shopOrder（店にない品目は後ろ）
  const catalog = {
    devices: { pc_basic: {}, l2_switch_8p: {}, l3_switch: {} },
    furniture: { plant: {}, sofa: {} },
    shopOrder: ['pc_basic', 'l2_switch_8p', 'plant', 'sofa'],
  };
  const owned = { pc_basic: 2, l2_switch_8p: 1, l3_switch: 1, plant: 1, sofa: 3 };

  it('自社オフィスでは、持っている機材と家具をすべて並べる（機材を先、店の並び順）', () => {
    expect(inventoryItems('office', owned, catalog)).toEqual([
      { kind: 'device', id: 'pc_basic' },
      { kind: 'device', id: 'l2_switch_8p' },
      { kind: 'device', id: 'l3_switch' },
      { kind: 'furniture', id: 'plant' },
      { kind: 'furniture', id: 'sofa' },
    ]);
  });

  it('案件の設計中は、家具も並べるが使えない印を付ける', () => {
    const items = inventoryItems('design', owned, catalog);
    expect(items.map((i) => i.id)).toEqual(['pc_basic', 'l2_switch_8p', 'l3_switch', 'plant', 'sofa']);
    expect(items.filter((i) => i.blocked === 'design').map((i) => i.id)).toEqual(['plant', 'sofa']);
    expect(items.filter((i) => i.kind === 'device' && i.blocked).length).toBe(0);
  });

  it('施工中と納品の結果では、何も並べない', () => {
    expect(inventoryItems('closed', owned, catalog)).toEqual([]);
  });

  it('在庫が0の品目は並べない', () => {
    expect(inventoryItems('office', { pc_basic: 0, plant: 1 }, catalog)).toEqual([{ kind: 'furniture', id: 'plant' }]);
  });

  it('定義にない ID を持っていたら例外にする', () => {
    expect(() => inventoryItems('office', { nope: 1 }, catalog)).toThrow('unknown inventory item: nope');
  });
});
