// 計算の入口（analyze）の性質（3.4）: 同じ入力は同じ結果、並びの順に依らない、結果の構成をもう一度入れても口のアドレスは変わらない
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../../sim/env';
import type { Network } from '../types';
import { analyze } from './analyze';

const dir = join(import.meta.dirname, '../../__golden__/cases');
const cases: Network[] = readdirSync(dir)
  .filter((f) => /^random-\d+\.json$/.test(f))
  .sort()
  .slice(0, 5)
  .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as Network);

const byUid = (n: Network) => [...n.nodes].sort((a, b) => (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0));
const addresses = (n: Network) => n.nodes.map((x) => [x.uid, x.interfaces.map((i) => [i.port, i.ip, i.prefix])]);

describe('analyze の性質（3.4）', () => {
  cases.forEach((c, i) => {
    it(`ケース ${i}: 同じ入力で2回呼ぶと、結果が等しい`, () => {
      const a = analyze(c, gameEnv.engine);
      const b = analyze(c, gameEnv.engine);
      expect(a.net).toEqual(b.net);
      expect(a.issues).toEqual(b.issues);
    });

    it(`ケース ${i}: 機器と配線の並びを逆にしても、機器の結果は uid で並べると等しい`, () => {
      const reversed: Network = { ...c, nodes: [...c.nodes].reverse(), links: [...c.links].reverse() };
      expect(byUid(analyze(reversed, gameEnv.engine).net)).toEqual(byUid(analyze(c, gameEnv.engine).net));
    });

    it(`ケース ${i}: 結果の構成をもう一度入れても、口のアドレスは変わらない`, () => {
      const first = analyze(c, gameEnv.engine).net;
      const second = analyze(first, gameEnv.engine).net;
      expect(addresses(second)).toEqual(addresses(first));
    });
  });
});
