// 挙動の記録の試験: 場面ごとに結果を求め、記録（snap/）と同じであることを確かめる。外部仕様を意図して変えたコミットでだけ `vitest -u` で記録を更新する
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { lessons } from 'virtual:game-data';
import { gameEnv } from '../sim/env';
import { lessonGoalResults, lessonLinks, lessonNodes } from '../sim/lesson';
import type { Network } from '../network/types';
import { recordOf } from './record';
import { solutions } from './solutions';

const engine = gameEnv.engine;
const snap = (name: string) => join(import.meta.dirname, 'snap', `${name}.json`);
const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe('教材（初期の構成と正解の構成）', () => {
  for (const lesson of lessons) {
    for (const stage of ['initial', 'solved'] as const) {
      if (stage === 'solved' && solutions[lesson.id] === undefined) continue;
      it(`${lesson.id} ${stage}`, async () => {
        const nodes = stage === 'solved' ? solutions[lesson.id](lessonNodes(lesson)) : lessonNodes(lesson);
        const links = lessonLinks(lesson);
        const net: Network = { nodes, links, segments: {} };
        await expect(json({ goals: lessonGoalResults(lesson.goals, nodes, links, engine), ...recordOf(net, engine) })).toMatchFileSnapshot(snap(`lesson-${lesson.id}-${stage}`));
      });
    }
  }
});

describe('乱数で作った構成（固定）', () => {
  const dir = join(import.meta.dirname, 'cases');
  const files = existsSync(dir) ? readdirSync(dir).filter((f) => /^random-\d+\.json$/.test(f)).sort() : [];
  for (const file of files) {
    it(file, async () => {
      const net = JSON.parse(readFileSync(join(dir, file), 'utf8')) as Network;
      await expect(json(recordOf(net, engine))).toMatchFileSnapshot(snap(file.replace('.json', '')));
    });
  }
});
