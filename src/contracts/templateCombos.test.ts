// 依頼の生成で組み合わさりうる、すべてのひな形と地図の組み合わせで、instantiateTemplate が例外を投げないことを確かめる。
// 依頼の選び方（offers.ts の addOffer）は、前提・解放・地図の読み込みが満たされたひな形を重みで選び、そのひな形の地図で作る。
// 前提と解放は「いつ届くか」だけを決め、組み合わせは増やさないため、組み合わせはひな形の数だけになる。
// 地図は maps/ の全件を読み込んだ状態として扱う（ゲームは起動時にすべての地図を読む）。
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contractTemplates } from 'virtual:game-data';
import type { ContractTemplate, GameMap } from '../data/schema';
import { instantiateTemplate } from './template';

const mapsDir = join(__dirname, '..', 'assets', 'data', 'maps');
const maps: Record<string, GameMap> = Object.fromEntries(
  readdirSync(mapsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => [f.replace(/\.json$/, ''), JSON.parse(readFileSync(join(mapsDir, f), 'utf8')) as GameMap]),
);

// 組み合わせ（ひな形と、そのひな形の地図）
const combos: { template: ContractTemplate; map: GameMap }[] = contractTemplates.map((template) => {
  const map = maps[template.map];
  if (map === undefined) throw new Error(`${template.id} の地図 ${template.map} がない`);
  return { template, map };
});

// 1組あたりの乱数の種の数
const SEEDS = 30;

describe('依頼の生成で組み合わさるすべてのひな形と地図', () => {
  it('組み合わせは、ひな形の数と同じ（地図は各ひな形に1つ）', () => {
    expect(combos.length).toBe(contractTemplates.length);
    expect(combos.length).toBeGreaterThan(0);
  });

  describe.each(combos.map((c) => [c.template.id, c] as const))('組み合わせ %s', (_id, { template, map }) => {
    it(`固定の種 1〜${SEEDS} のどれでも、例外を投げずに依頼を作れる`, () => {
      for (let seed = 1; seed <= SEEDS; seed++) {
        expect(() => instantiateTemplate(template, map, 0, seed), `種 ${seed}`).not.toThrow();
      }
    });
  });
});
