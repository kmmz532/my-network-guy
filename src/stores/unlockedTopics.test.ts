// 論点の解放（遊び方の能力 allTopics）。allTopics の遊び方は全論点、そうでない遊び方は会社のレベルで解放された論点だけを出す。
import { describe, expect, it } from 'vitest';
import { balance } from 'virtual:game-data';
import { MODE_TRAITS, type GameMode } from '../company/company';
import { TOPICS } from '../network/topics';
import { levelOf } from '../sim/level';
import { unlockedTopicsOf } from './gameHelpers';

describe('論点の解放', () => {
  it('遊び方ごとの能力で、全論点か、会社のレベルで解放された論点かが決まる', () => {
    const level = levelOf(0, balance);
    for (const mode of Object.keys(MODE_TRAITS) as GameMode[]) {
      const want = MODE_TRAITS[mode].allTopics ? TOPICS.map((t) => t.id) : TOPICS.filter((t) => t.unlock === null || level >= t.unlock).map((t) => t.id);
      expect([...unlockedTopicsOf({ mode, companyExp: 0 })].sort()).toEqual(want.sort());
    }
  });
});
