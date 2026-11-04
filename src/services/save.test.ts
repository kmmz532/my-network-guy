import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, migrate, type SaveData } from './migrations';
import { exportSave, importSave } from './saveFile';

const sample: SaveData = {
  clock: { minute: 720, money: 300000, paidMonths: 1, bankrupt: false },
  reputation: 2,
  owned: { pc_basic: 1 },
  completed: ['c001_direct_link'],
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

  });
