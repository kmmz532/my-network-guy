// 会社の型の試験: 保存の fixture を最新版まで移行し、companyOf で取り出した項目の集合が COMPANY_KEYS と等しいこと
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate } from '../services/migrations';
import { COMPANY_KEYS, companyOf, type Company } from './world';

type Fixture = Record<string, { saveVersion: number; data: unknown }>;

describe('会社の型', () => {
  const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '../services/__fixtures__/save-v50.json'), 'utf8')) as Fixture;
  for (const [name, entry] of Object.entries(fixture)) {
    it(`${name}: 最新版まで移行した値に companyOf を通すと、キーの集合が COMPANY_KEYS と等しい`, () => {
      const world = companyOf(migrate(entry.saveVersion, entry.data) as Company);
      expect(Object.keys(world).sort()).toEqual([...COMPANY_KEYS].sort());
    });
  }
});
