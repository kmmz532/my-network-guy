import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, migrate, type SaveData } from './migrations';
import { exportSave, importSave } from './saveFile';

const sample: SaveData = {
  clock: { minute: 720, money: 300000, paidMonths: 1, bankrupt: false },
  reputation: 2,
  owned: { pc_basic: 1 },
  completed: ['c001_direct_link'],
  offers: [],
  nextOfferMinute: 0,
  offerSeq: 0,
  rng: 1,
  active: null,
  office: { nodes: [], links: [], seq: 0 },
  effects: { buildSpeed: 0 },
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

describe('v4 → v5', () => {
  it('手入力のIPアドレスを色に置き換える', () => {
    const node = (uid: string, ip: string) => ({
      uid,
      device: 'pc_basic',
      x: 0,
      y: 0,
      locked: false,
      configLocked: false,
      interfaces: [{ port: 0, ip, prefix: 24 }],
      gateway: null,
      routes: [],
      services: [],
    });
    const v4 = {
      ...sample,
      active: { nodes: [node('a', '192.168.1.10'), node('b', '192.168.1.11'), node('c', '192.168.2.10')] },
    };
    const out = migrate(4, v4);
    const colors = out.active!.nodes.map((n) => n.colors?.[0]);
    expect(colors[0]).toBe(colors[1]);
    expect(colors[2]).not.toBe(colors[0]);
  });
});
