// 保存の枠を読める会社と読めない枠に振り分ける試験。読めない枠は予備値で埋めず、ほかの枠は読めたまま返す
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION } from './migrations';
import { recordsOfMode, splitRecords, type SaveRecord } from './saveRecords';

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

describe('recordsOfMode', () => {
  const careerData = fixture.career.data as SaveRecord['data'];
  const sandboxData = { ...(fixture.career.data as object), mode: 'sandbox' } as unknown as SaveRecord['data'];
  const rec = (slot: number, data: SaveRecord['data'], saveVersion = SAVE_VERSION): SaveRecord => ({ slot, saveVersion, savedAt: slot, data });
  const bad = (slot: number): SaveRecord => rec(slot, brokenData as unknown as SaveRecord['data'], 38);

  it('番号によらず、記録の遊び方で経営とサンドボックスを分ける', () => {
    const records = [rec(11, careerData), rec(12, sandboxData), rec(16, sandboxData), rec(21, careerData)];
    expect(recordsOfMode(records, 'career').saves.map((s) => s.slot)).toEqual([11, 21]);
    expect(recordsOfMode(records, 'sandbox').saves.map((s) => s.slot)).toEqual([12, 16]);
  });

  it('使われている番号は、遊び方を問わず全部返す', () => {
    const records = [rec(11, careerData), rec(12, sandboxData), bad(13)];
    expect(recordsOfMode(records, 'career').occupied).toEqual([11, 12, 13]);
  });

  it('読めない枠は番号から遊び方を推し量り、新しい番号の枠は両方の一覧に出す。消えない', () => {
    const records = [bad(12), bad(22), bad(17)];
    expect(recordsOfMode(records, 'career').broken.map((b) => b.slot)).toEqual([12, 17]);
    expect(recordsOfMode(records, 'sandbox').broken.map((b) => b.slot)).toEqual([22, 17]);
  });
});
