// 世界の型の試験: 保存の fixture を最新版まで移行し、worldOf で取り出した項目の集合が WORLD_KEYS と等しいこと
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate } from '../services/migrations';
import { WORLD_KEYS, worldOf, type World } from './world';

type Fixture = Record<string, { saveVersion: number; data: unknown }>;

describe('世界の型', () => {
  const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../services/__fixtures__/save-v50.json'), 'utf8')) as Fixture;
  for (const [name, entry] of Object.entries(fixture)) {
    it(`${name}: 最新版まで移行した値に worldOf を通すと、キーの集合が WORLD_KEYS と等しい`, () => {
      const world = worldOf(migrate(entry.saveVersion, entry.data) as World);
      expect(Object.keys(world).sort()).toEqual([...WORLD_KEYS].sort());
    });
  }
});
