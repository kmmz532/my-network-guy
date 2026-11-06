// 定型案件（ひな形）の地図が、地図のデータにあることを確かめる。
// 地図が読み込まれていないひな形は依頼から黙って外れるため（2026-11-06 の「小規模LANしか届かない」の原因）、ここで止める。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const dataDir = join(__dirname, '..', 'assets', 'data');
const mapsDir = join(dataDir, 'maps');
const templatesDir = join(dataDir, 'contracts', 'templates');

describe('定型案件の地図', () => {
  it('すべてのひな形の地図が maps/ にある', () => {
    const templates = readdirSync(templatesDir).filter((f) => f.endsWith('.json'));
    expect(templates.length).toBeGreaterThan(0);
    for (const file of templates) {
      const raw = JSON.parse(readFileSync(join(templatesDir, file), 'utf8')) as { map?: string; variantOf?: string };
      // 変化形は地図を持たず、元のひな形の地図を使う（N51a）
      if (raw.variantOf !== undefined) {
        expect(existsSync(join(templatesDir, `${raw.variantOf}.json`)), `${file} の元のひな形 ${raw.variantOf}`).toBe(true);
        continue;
      }
      const { map } = raw as { map: string };
      expect(existsSync(join(mapsDir, `${map}.json`)), `${file} の地図 ${map}`).toBe(true);
    }
  });
});
