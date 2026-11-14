// 保存の枠を読める会社と読めない枠に振り分ける試験。読めない枠は予備値で埋めず、ほかの枠は読めたまま返す
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from './migrations';
import { splitRecords, type SaveRecord } from './saveRecords';

const fixture = JSON.parse(readFileSync(join(import.meta.dirname, '__fixtures__', `save-v${SAVE_VERSION}.json`), 'utf8')) as Record<string, { saveVersion: number; data: unknown }>;

// 版 38 の配線（定価のないケーブル「nope」）。v38 → v39 の移行で例外になる
const brokenData = {
  active: [],
  office: {
    nodes: [
      { uid: 'n1', x: 0, y: 0 },
      { uid: 'n2', x: 3, y: 0 },
    ],
    links: [{ uid: 'l1', cable: 'nope', a: { node: 'n1' }, b: { node: 'n2' } }],
  },
};

describe('splitRecords', () => {
  it('読める枠は会社として返し、移行で例外になる枠は読めない枠として返す（reject しない）', () => {
    const good: SaveRecord = { slot: 11, saveVersion: SAVE_VERSION, savedAt: 100, data: fixture.career.data as SaveRecord['data'] };
    const bad: SaveRecord = { slot: 12, saveVersion: 38, savedAt: 200, data: brokenData as unknown as SaveRecord['data'] };
    const result = splitRecords([good, bad]);
    expect(result.saves.map((s) => s.slot)).toEqual([11]);
    expect(result.saves[0].savedAt).toBe(100);
    expect(result.broken).toEqual([{ slot: 12, savedAt: 200 }]);
  });

  it('読めない枠だけのときは、会社の一覧は空で、読めない枠を返す', () => {
    const bad: SaveRecord = { slot: 21, saveVersion: 38, savedAt: 5, data: brokenData as unknown as SaveRecord['data'] };
    expect(splitRecords([bad])).toEqual({ saves: [], broken: [{ slot: 21, savedAt: 5 }] });
  });
});
