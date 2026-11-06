// 複数の置く範囲（spawnGroups）と変化形（variantOf）の確かめ（N51a の 2 章）
import { describe, expect, it } from 'vitest';
import { contractTemplates } from 'virtual:game-data';
import longHallJson from '../assets/data/maps/long_hall.json';
import type { ContractTemplate, GameMap } from '../data/schema';
import { templateSchema } from '../data/schema';
import { instantiateTemplate, pcCountRangeOf } from './template';

const longHall = longHallJson as unknown as GameMap;
const longHallTemplate = contractTemplates.find((t) => t.id === 't_long_hall') as ContractTemplate;

describe('spawnGroups', () => {
  it('各グループの範囲に、そのグループの台数の範囲で PC を置き、ref は通し番号になる', () => {
    const range = pcCountRangeOf(longHallTemplate);
    expect(range).toEqual({ min: 4, max: 6 });
    for (let seed = 1; seed <= 200; seed++) {
      const { offer } = instantiateTemplate(longHallTemplate, longHall, 0, seed);
      const placed = offer.contract.placed;
      expect(offer.params.pcCount).toBeGreaterThanOrEqual(range.min);
      expect(offer.params.pcCount).toBeLessThanOrEqual(range.max);
      expect(placed.map((p) => p.ref)).toEqual(placed.map((_, i) => `pc_${i + 1}`));
      for (const p of placed) {
        const inLeft = p.x >= 1 && p.x < 9 && p.y >= 1 && p.y < 7;
        const inRight = p.x >= 30 && p.x < 39 && p.y >= 1 && p.y < 7;
        expect(inLeft || inRight).toBe(true);
        expect(longHall.legend[longHall.tiles[p.y][p.x]]).toBe('floor');
      }
    }
  });

  it('spawnArea と spawnGroups を両方書く、または、どちらも書かないと検証で失敗する', () => {
    const base = { ...longHallTemplate, spawnArea: undefined, spawnGroups: undefined, params: undefined };
    const groups = longHallTemplate.spawnGroups;
    expect(templateSchema.safeParse({ ...base, spawnGroups: groups, spawnArea: { x: 1, y: 1, width: 2, height: 2 } }).success).toBe(false);
    expect(templateSchema.safeParse({ ...base }).success).toBe(false);
  });
});

describe('変化形（variantOf）', () => {
  it('元のひな形の値を引き継ぎ、変化形は通知を出さず、文言は元のひな形のものを使う', () => {
    const large = contractTemplates.find((t) => t.id === 't_long_hall_large');
    expect(large).toBeDefined();
    expect(large?.textId).toBe('t_long_hall');
    expect(large?.announce).toBe(false);
    expect(large?.map).toBe('long_hall');
    expect(large?.goals).toEqual(longHallTemplate.goals);
    expect(large?.unlockLevel).toBe(longHallTemplate.unlockLevel + 3);
  });

  it('新しい種類は通知を出し、文言は自分の ID を使う', () => {
    const root = contractTemplates.find((t) => t.id === 't_long_hall');
    expect(root?.announce).toBe(true);
    expect(root?.textId).toBe('t_long_hall');
  });
});
