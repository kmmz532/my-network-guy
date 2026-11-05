import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, migrate, type SaveData } from './migrations';
import type { Staff } from '../data/schema';
import { exportSave, importSave } from './saveFile';

const member = (uid: string): Staff => ({
  uid,
  name: 'staff.name.0',
  look: 'blue',
  quirk: 'q1',
  job: 'network',
  level: 1,
  exp: 0,
  salary: 200000,
  certs: [],
  training: null,
});

const sample: SaveData = {
  clock: { minute: 720, money: 300000, paidMonths: 1, bankrupt: false },
  reputation: 2,
  owned: { pc_basic: 1 },
  completed: ['c001_direct_link'],
  offers: [],
  nextOfferMinute: 0,
  offerSeq: 0,
  rng: 1,
  active: [],
  focus: null,
  office: { nodes: [], links: [], seq: 0, furniture: [], furnitureSeq: 0 },
  effects: { buildSpeed: 0 },
  staff: [member('s0'), member('s1')],
  staffSeq: 2,
  candidates: [],
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

describe('v6 → v7', () => {
  // 旧マップの机の位置（x=9, y=3）に置いたPCは、机がないので机を足す。初期の机（3,3）と（6,3）は初期の机のまま
  const pc = (uid: string, x: number, y: number) => ({
    uid,
    device: 'pc_basic',
    x,
    y,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: [],
  });
  const { staff: _staff, staffSeq: _seq, ...withoutStaff } = sample;
  const v6 = {
    ...withoutStaff,
    // 旧い形式の案件（単独）
    active: null,
    office: { nodes: [pc('u0', 3, 3), pc('u1', 9, 3)], links: [], seq: 2 },
  };

  it('社員の人数と初期の机を追加する', () => {
    const out = migrate(6, v6);
    expect(out.staff).toHaveLength(2);
    expect(out.office.furniture.map((f) => [f.id, f.x, f.y])).toEqual([
      ['desk', 3, 3],
      ['desk', 6, 3],
      ['desk', 9, 3],
    ]);
  });

  it('机のないマスに置いたPCには机を足し、家具の連番を進める', () => {
    const out = migrate(6, v6);
    expect(out.office.furniture.map((f) => f.uid)).toEqual(['f0', 'f1', 'f2']);
    expect(out.office.furnitureSeq).toBe(3);
  });
});

describe('v7 → v8', () => {
  // 人数の社員を作る。1人目と2人目は初期の職種（network・infra）、3人目は network
  const { staff: _staff, staffSeq: _seq, ...withoutStaff } = sample;
  const v7 = { ...withoutStaff, active: null, staff: 3 };

  it('人数ぶんの社員を、初期の職種の順に作る', () => {
    const out = migrate(7, v7);
    expect(out.staff.map((s) => [s.uid, s.job, s.level])).toEqual([
      ['s0', 'network', 1],
      ['s1', 'infra', 1],
      ['s2', 'network', 1],
    ]);
    expect(out.staffSeq).toBe(3);
  });
});

describe('v8 → v9', () => {
  const { active: _active, focus: _focus, ...withoutActive } = sample;

  it('単独の案件は一覧にし、その案件を設計の対象にする', () => {
    const project = { id: 'c001_direct_link', nodes: [] };
    const out = migrate(8, { ...withoutActive, active: project });
    expect(out.active).toEqual([{ ...project, due: null, crew: ['s0', 's1'] }]);
    expect(out.focus).toBe('c001_direct_link');
  });

  it('案件がなければ一覧は空で、設計の対象もない', () => {
    const out = migrate(8, { ...withoutActive, active: null });
    expect(out.active).toEqual([]);
    expect(out.focus).toBeNull();
  });
});

describe('v9 → v10', () => {
  const { active: _active, focus: _focus, ...withoutActive } = sample;

  it('受注中の案件に期日がなければ、期日のない案件として扱う', () => {
    const project = { id: 'c001_direct_link', nodes: [] };
    const out = migrate(9, { ...withoutActive, active: [project], focus: 'c001_direct_link' });
    expect(out.active[0]).toEqual({ id: 'c001_direct_link', nodes: [], due: null, crew: ['s0', 's1'] });
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
    const colors = out.active[0].nodes.map((n) => n.colors?.[0]);
    expect(colors[0]).toBe(colors[1]);
    expect(colors[2]).not.toBe(colors[0]);
  });
});
