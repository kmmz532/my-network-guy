import { describe, expect, it } from 'vitest';
import l3TwoRoomsJson from '../assets/data/contracts/templates/t_l3_two_rooms.json';
import rareExpoJson from '../assets/data/contracts/templates/t_rare_expo_lan.json';
import twoRoomsJson from '../assets/data/contracts/templates/t_two_rooms_lan.json';
import twoSitesJson from '../assets/data/contracts/templates/t_two_sites_lan.json';
import officeTwoRoomsJson from '../assets/data/maps/office_two_rooms.json';
import officeTwoSitesJson from '../assets/data/maps/office_two_sites.json';
import type { ContractTemplate, GameMap } from '../data/schema';
import { instantiateTemplate, pcCountRangeOf } from './template';

// 定型案件（2 部屋・2 拠点）が、どの乱数でも案件になることを確かめる
const cases: { template: ContractTemplate; map: GameMap }[] = [
  { template: twoRoomsJson as unknown as ContractTemplate, map: officeTwoRoomsJson as unknown as GameMap },
  { template: twoSitesJson as unknown as ContractTemplate, map: officeTwoSitesJson as unknown as GameMap },
  { template: l3TwoRoomsJson as unknown as ContractTemplate, map: officeTwoRoomsJson as unknown as GameMap },
  { template: rareExpoJson as unknown as ContractTemplate, map: officeTwoRoomsJson as unknown as GameMap },
];

describe.each(cases)('定型案件 $template.id', ({ template, map }) => {
  it('どの乱数でも、台数の範囲に収まり、すべての PC を床の上に置く', () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { offer } = instantiateTemplate(template, map, 0, seed);
      const n = offer.params.pcCount;
      const range = pcCountRangeOf(template);
      expect(n).toBeGreaterThanOrEqual(range.min);
      expect(n).toBeLessThanOrEqual(range.max);
      expect(offer.contract.placed).toHaveLength(n);
      for (const p of offer.contract.placed) {
        expect(map.legend[map.tiles[p.y][p.x]]).toBe('floor');
      }
    }
  });

  it('すべての PC を ping で確かめる目標になり、報酬と予算は正の値になる', () => {
    const { offer } = instantiateTemplate(template, map, 0, 7);
    const refs = offer.contract.placed.map((p) => p.ref);
    expect(offer.contract.goals).toContainEqual({ type: 'ping_all', nodes: refs });
    expect(offer.contract.reward.money).toBeGreaterThan(0);
    expect(offer.contract.budget).toBeGreaterThan(0);
  });
});
