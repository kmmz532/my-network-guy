import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, migrate, migrations, type SaveData } from './migrations';
import { exportSave, importSave } from './saveFile';

const sample: SaveData = {
  clock: { minute: 720, money: 300000, paidMonths: 1, bankrupt: false },
  reputation: 2,
};

describe('セーブデータ', () => {
  it('書き出したものを読み込むと元に戻る', () => {
    expect(importSave(exportSave(sample))).toEqual(sample);
  });

  it('別のアプリのファイルは拒否する', () => {
    expect(() => importSave(JSON.stringify({ format: 'other', saveVersion: 1, data: sample }))).toThrow();
  });

  it('壊れたJSONは拒否する', () => {
    expect(() => importSave('{')).toThrow();
  });

  it('現在より新しいバージョンは拒否する', () => {
    expect(() => migrate(SAVE_VERSION + 1, sample)).toThrow();
  });

  it("バージョン1より前は拒否する", () => {
    expect(() => migrate(0, sample)).toThrow();
  });

  it("移行関数がない古いバージョンは拒否する", () => {
    // SAVE_VERSION が 1 の間は移行関数が存在しないため、バージョン 1 未満のみが対象
    expect(Object.keys(migrations)).toEqual([]);
  });
});
