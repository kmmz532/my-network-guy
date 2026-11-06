// 通れず置けないマスの判定（N51b）。壁・壁に掛ける物・柱は同じ判定にする
import { describe, expect, it } from 'vitest';
import factoryJson from '../assets/data/maps/factory.json';
import { isBlocked, tileKind } from './tileKind';
import type { GameMap } from './schema';

describe('isBlocked', () => {
  it('壁・柱・壁に掛ける物は通れず、床・ドア・何もない場所は通れる', () => {
    for (const kind of ['wall', 'pillar', 'window', 'clock', 'poster', 'whiteboard']) expect(isBlocked(kind)).toBe(true);
    for (const kind of ['floor', 'door', 'void', 'ground', 'road', undefined]) expect(isBlocked(kind)).toBe(false);
  });
});

describe('工場の地図の柱', () => {
  const map = factoryJson as unknown as GameMap;
  it('2×2 の柱は pillar になり、通れない。床の判定にも入らない', () => {
    for (const [x, y] of [[6, 3], [7, 4], [15, 7], [24, 8]]) {
      expect(tileKind(map, x, y)).toBe('pillar');
      expect(isBlocked(tileKind(map, x, y))).toBe(true);
    }
    expect(tileKind(map, 2, 2)).toBe('floor');
  });
});
