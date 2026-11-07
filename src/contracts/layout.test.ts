// 依頼先のオフィスの配置（N76）。台数の最大でも机が並び、全部の机へ床を通って行け、家具が PC と重ならないことを確かめる。
import { describe, expect, it } from 'vitest';
import { contractTemplates } from 'virtual:game-data';
import type { ContractTemplate, GameMap } from '../data/schema';
import { tileKind } from '../data/tileKind';
import { DECOR_RATIO, deskReachable, furnitureOf, layoutDesks, placeDecor } from './layout';
import { instantiateTemplate, pcCountRangeOf, spawnGroupsOf } from './template';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const mapsDir = join(__dirname, '..', 'assets', 'data', 'maps');
const loadMap = (id: string): GameMap => JSON.parse(readFileSync(join(mapsDir, `${id}.json`), 'utf8')) as GameMap;
const officeSmall = loadMap('office_small');

const templateOf = (id: string): ContractTemplate => {
  const t = contractTemplates.find((x) => x.id === id);
  if (!t) throw new Error(`${id} がない`);
  return t;
};
const key = (x: number, y: number) => `${x},${y}`;

describe('机の並べ方（layoutDesks）', () => {
  it('範囲の床に n 台の机を置き、机の周りに床が残る（同じ乱数なら同じ結果）', () => {
    const map = officeSmall;
    const rect = { x: 2, y: 2, width: 10, height: 6 };
    for (let seed = 1; seed <= 100; seed++) {
      const a = layoutDesks(map, rect, 6, ['island', 'wall'], new Set(), [], seed);
      const b = layoutDesks(map, rect, 6, ['island', 'wall'], new Set(), [], seed);
      expect(a).toEqual(b);
      expect(a.laid).not.toBeNull();
      const desks = a.laid?.desks ?? [];
      expect(desks.length).toBe(6);
      expect(new Set(desks.map((d) => key(d.x, d.y))).size).toBe(6);
      for (const d of desks) {
        expect(d.x >= rect.x && d.x < rect.x + rect.width && d.y >= rect.y && d.y < rect.y + rect.height).toBe(true);
        expect(tileKind(map, d.x, d.y)).toBe('floor');
      }
      expect(deskReachable(map, new Set(), desks)).toBe(true);
    }
  });

  it('床のない範囲や狭すぎる範囲では、作れないと分かる（null）', () => {
    const map = officeSmall;
    const tiny = { x: 1, y: 1, width: 1, height: 1 };
    expect(layoutDesks(map, tiny, 3, ['island', 'wall'], new Set(), [], 7).laid).toBeNull();
  });
});

describe('飾りの家具（placeDecor）', () => {
  it('床の 5〜10% を目安に置き、机と PC の範囲には置かず、机へ行けなくしない', () => {
    const map = officeSmall;
    const rect = { x: 2, y: 2, width: 10, height: 6 };
    for (let seed = 1; seed <= 50; seed++) {
      const laid = layoutDesks(map, rect, 4, ['island', 'wall'], new Set(), [], seed).laid;
      if (laid === null) throw new Error('机が並ばない');
      const deskSet = new Set(laid.desks.map((d) => key(d.x, d.y)));
      const decor = placeDecor(map, deskSet, laid.desks, [rect], ['plant', 'trash'], laid.rng);
      let floor = 0;
      for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) if (tileKind(map, x, y) === 'floor') floor++;
      expect(decor.furniture.length).toBeLessThanOrEqual(Math.ceil(floor * DECOR_RATIO.max));
      const blocked = new Set([...deskSet, ...decor.furniture.map((f) => key(f.x, f.y))]);
      for (const f of decor.furniture) {
        expect(deskSet.has(key(f.x, f.y))).toBe(false);
        expect(f.x >= rect.x && f.x < rect.x + rect.width && f.y >= rect.y && f.y < rect.y + rect.height).toBe(false);
      }
      expect(deskReachable(map, blocked, laid.desks)).toBe(true);
    }
  });
});

describe('ひな形の配置（instantiateTemplate）', () => {
  it('台数の最大でも配置でき、机が PC の位置に敷かれ、家具が PC と重ならない', () => {
    for (const t of contractTemplates) {
      const map = loadMap(t.map);
      const max = pcCountRangeOf(t).max;
      const range = spawnGroupsOf(t);
      for (let seed = 1; seed <= 20; seed++) {
        const { offer } = instantiateTemplate(t, map, 0, seed);
        const contract = offer.contract;
        expect(offer.params.pcCount).toBeGreaterThanOrEqual(pcCountRangeOf(t).min);
        expect(offer.params.pcCount).toBeLessThanOrEqual(max);
        const furniture = furnitureOf(map.furniture, contract.furniture);
        const cells = new Set(furniture.map((f) => key(f.x, f.y)));
        for (const p of contract.placed) {
          expect(cells.has(key(p.x, p.y))).toBe(true);
          expect(range.some((g) => p.x >= g.x && p.x < g.x + g.width && p.y >= g.y && p.y < g.y + g.height)).toBe(true);
        }
      }
    }
  });

  it('机の島と壁沿いの型で、台数の多い小規模LANの配置が作れる', () => {
    const t = templateOf('t_small_lan');
    const { offer } = instantiateTemplate(t, officeSmall, 0, 3);
    expect(offer.contract.furniture?.some((f) => f.id === 'desk_only')).toBe(true);
  });
});


// 机の向き（N171）: 島型の2列は向かい合い、壁沿いは壁に向かい、窓口は手前を向く
describe('机の向き（N171）', () => {
  it('島型は、左の列が右向き・右の列が左向きで向かい合う', () => {
    for (let seed = 1; seed <= 30; seed++) {
      const got = layoutDesks(officeSmall, { x: 2, y: 2, width: 10, height: 6 }, 6, ['island'], new Set(), [], seed);
      if (got.laid === null) continue;
      for (const d of got.laid.desks) {
        expect(["left", "right"]).toContain(d.facing);
        // 右向きの机の右隣は、左向きの机（列が向かい合う）
        if (d.facing === "right") expect(got.laid.desks.some((o) => o.x === d.x + 1 && o.y === d.y && o.facing === "left")).toBe(true);
      }
    }
  });

  it('窓口の机は手前（down）を向く', () => {
    const got = layoutDesks(officeSmall, { x: 2, y: 2, width: 10, height: 6 }, 4, ['reception'], new Set(), [], 3);
    if (got.laid !== null) for (const d of got.laid.desks) expect(d.facing).toBe('down');
  });
});
