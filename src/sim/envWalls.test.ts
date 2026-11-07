// 地図の壁を電波の減衰に渡す（N151）: 壁のマスだけが壁として数えられ、地図がなければ壁はない
import { describe, expect, it } from 'vitest';
import { engineWithWalls, gameEnv } from './env';
import type { GameMap } from '../data/schema';

const map = { tiles: ['.#D'], legend: { '.': 'floor', '#': 'wall', D: 'door' } } as unknown as GameMap;

describe('地図の壁（N151）', () => {
  it('壁のマスは壁、ドアと床は壁ではない', () => {
    const e = engineWithWalls(gameEnv.engine, map);
    expect(e.wallAt?.(1, 0)).toBe(true);
    expect(e.wallAt?.(2, 0)).toBe(false);
    expect(e.wallAt?.(0, 0)).toBe(false);
  });
  it('地図がなければ壁の判定はない', () => {
    expect(engineWithWalls(gameEnv.engine, undefined).wallAt).toBeUndefined();
  });
});
