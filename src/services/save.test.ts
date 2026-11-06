import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, isSaveData, migrate, type SaveData } from './migrations';
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
  mode: 'career',
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
  office: { size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [], furnitureSeq: 0 },
  effects: { buildSpeed: 0 },
  staff: [member('s0'), member('s1')],
  staffSeq: 2,
  candidates: [],
  guidesDone: ['c001_direct_link'],
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
  // 旧マップの机の位置（x=9, y=3）に置いたPCは、机がないので机を足す（2,3 の PC は初期の机の上）。初期の机（2,3）と（4,3）は初期の机のまま
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
    office: { size: { w: 5, h: 5 }, nodes: [pc('u0', 2, 3), pc('u1', 9, 3)], links: [], seq: 2 },
  };

  it('社員の人数と初期の机を追加する', () => {
    const out = migrate(6, v6);
    expect(out.staff).toHaveLength(2);
    expect(out.office.furniture.map((f) => [f.id, f.x, f.y])).toEqual([
      ['desk', 2, 3],
      ['desk', 4, 3],
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
    expect(out.active).toEqual([{ ...project, due: null, crew: ['s0', 's1'], testedOk: false }]);
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
    expect(out.active[0]).toEqual({ id: 'c001_direct_link', nodes: [], due: null, crew: ['s0', 's1'], testedOk: false });
  });
});

describe('v4 → v5 → v13', () => {
  it('手入力のIPアドレスは、色の時代の規則を経て、色を外したIPアドレスになる', () => {
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
    const nodes = out.active[0].nodes;
    // 同じネットワークだった2台は同じ色になり、同じネットワークのアドレスを持つ。色は残らない
    expect(nodes.map((n) => n.interfaces[0].ip)).toEqual(['192.168.101.11', '192.168.101.12', '192.168.102.11']);
    expect(nodes.every((n) => !('colors' in n))).toBe(true);
  });
});

describe('v12 → v13', () => {
  const pc = (uid: string, x: number, color: number) => ({
    uid,
    device: 'pc_basic',
    x,
    y: 0,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: [],
    colors: { 0: color },
  });
  const router = {
    uid: 'r',
    device: 'router_basic',
    x: 5,
    y: 0,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: [],
    colors: { 0: 1 },
  };

  it('色を持つ機器に、色の時代の規則でIPアドレス・ゲートウェイ・セグメントを作り、色を外す', () => {
    const v12 = {
      ...sample,
      active: [
        {
          id: 'x',
          nodes: [pc('pc_a', 0, 1), pc('pc_b', 1, 1), router],
          links: [
            {
              uid: 'l0',
              cable: 'utp_cat5e',
              a: { node: 'pc_a', port: 0 },
              b: { node: 'r', port: 0 },
              path: [
                [0, 0],
                [5, 0],
              ],
            },
          ],
        },
      ],
    };
    const out = migrate(12, v12);
    const [a, b, r] = out.active[0].nodes;
    expect(a.interfaces).toEqual([{ port: 0, ip: '192.168.101.11', prefix: 24 }]);
    expect(a.gateway).toBe('192.168.101.1');
    expect(b.interfaces).toEqual([{ port: 0, ip: '192.168.101.12', prefix: 24 }]);
    expect(b.gateway).toBeNull();
    expect(r.interfaces).toEqual([{ port: 0, ip: '192.168.101.1', prefix: 24 }]);
    expect(out.active[0].segments).toEqual({ 'pc_a:0': { network: '192.168.101.0', prefix: 24 } });
    expect([a, b, r].some((n) => 'colors' in n)).toBe(false);
  });

  it('色を持たない案件は、そのまま残す', () => {
    const v12 = { ...sample, active: [{ id: 'x', nodes: [], links: [] }] };
    expect(migrate(12, v12).active[0]).toEqual({ id: 'x', nodes: [], links: [], testedOk: false });
  });
});

describe('v15 → v16', () => {
  const { guidesDone: _guidesDone, ...v15 } = sample;

  it('初めての概念の案内を終えた案件は、移行前は空のまま（どの案件の案内も終えていない）', () => {
    const out = migrate(15, v15);
    expect(out.guidesDone).toEqual([]);
  });

  it('移行後の形式は、読み込んで書き出しても元に戻る', () => {
    const out = migrate(15, v15);
    expect(importSave(exportSave(out))).toEqual(out);
  });

  it('guidesDone が文字列の配列でなければ拒否する', () => {
    expect(() => migrate(16, { ...sample, guidesDone: [1] })).toThrow();
  });
});

describe('v14 → v15', () => {
  const { active: _active, focus: _focus, ...withoutActive } = sample;

  it('受注中の案件は、テストに合格していないものとして扱う（testedOk: false）', () => {
    const project = { id: 'c001_direct_link', nodes: [], links: [] };
    const out = migrate(14, { ...withoutActive, active: [project], focus: 'c001_direct_link' });
    expect(out.active).toEqual([{ ...project, testedOk: false }]);
    expect(out.focus).toBe('c001_direct_link');
  });

  it('案件がなければ、そのまま残す', () => {
    const out = migrate(14, { ...withoutActive, active: [], focus: null });
    expect(out.active).toEqual([]);
  });
});

describe('v13 → v14', () => {
  const node = (uid: string, device: string, extra: Record<string, unknown> = {}) => ({
    uid,
    device,
    x: 0,
    y: 0,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: [],
    ...extra,
  });
  const { active: _active, office: _office, ...withoutNet } = sample;

  it('サービスが空のサーバーに、機材の既定のサービス（HTTP 80）を入れる。自社オフィスと受注中の案件の両方', () => {
    const v13 = {
      ...withoutNet,
      office: { ...sample.office, nodes: [node('o_srv', 'server_basic')] },
      active: [{ id: 'x', nodes: [node('a_srv', 'server_basic')], links: [] }],
    };
    const out = migrate(13, v13);
    expect(out.office.nodes[0].services).toEqual([{ protocol: 'http', port: 80 }]);
    expect(out.active[0].nodes[0].services).toEqual([{ protocol: 'http', port: 80 }]);
  });

  it('設定を変えられない（configLocked）サーバーは変えない', () => {
    const v13 = {
      ...withoutNet,
      office: { ...sample.office, nodes: [node('o_srv', 'server_basic', { configLocked: true })] },
      active: [{ id: 'x', nodes: [node('a_srv', 'server_basic', { configLocked: true })], links: [] }],
    };
    const out = migrate(13, v13);
    expect(out.office.nodes[0].services).toEqual([]);
    expect(out.active[0].nodes[0].services).toEqual([]);
  });

  it('サーバー以外の機器や、サービスが既にあるサーバーは変えない', () => {
    const pc = node('o_pc', 'pc_basic');
    const busy = node('o_srv', 'server_basic', { services: [{ protocol: 'http', port: 8080 }] });
    const v13 = { ...withoutNet, office: { ...sample.office, nodes: [pc, busy] }, active: [] };
    const out = migrate(13, v13);
    // 対応表（hosts）は v19 → v20 で空の配列が入る
    expect(out.office.nodes[0]).toEqual({ ...pc, hosts: [] });
    expect(out.office.nodes[1].services).toEqual([{ protocol: 'http', port: 8080 }]);
  });
});

describe('v16 → v17', () => {
  const { office: _office, ...withoutOffice } = sample;
  const v16 = { ...withoutOffice, office: { nodes: [], links: [], seq: 0, furniture: [], furnitureSeq: 0 } };

  it('自社オフィスの部屋の大きさは、移行前の固定のマップ（14×8）とする', () => {
    const out = migrate(16, v16);
    expect(out.office.size).toEqual({ w: 14, h: 8 });
  });

  it('部屋の大きさを足したほかは、そのまま残す', () => {
    const out = migrate(16, v16);
    expect(out.office).toEqual({ ...v16.office, size: { w: 14, h: 8 }, innerWalls: [], doors: [], annexes: [] });
  });

  it('移行後の形式は、読み込んで書き出しても元に戻る', () => {
    const out = migrate(16, v16);
    expect(importSave(exportSave(out))).toEqual(out);
  });

  it('部屋の大きさがない自社オフィスは拒否する', () => {
    const { size: _size, ...officeWithoutSize } = sample.office;
    expect(() => migrate(17, { ...sample, office: officeWithoutSize })).toThrow();
  });
});

describe('v17 → v18', () => {
  const { office: _office, ...withoutOffice } = sample;
  const v17 = { ...withoutOffice, office: { size: { w: 7, h: 5 }, nodes: [], links: [], seq: 0, furniture: [], furnitureSeq: 0 } };

  it('内側の壁・ドア・別室は空で移行する（部屋の大きさはそのまま）', () => {
    const out = migrate(17, v17);
    expect(out.office.innerWalls).toEqual([]);
    expect(out.office.doors).toEqual([]);
    expect(out.office.annexes).toEqual([]);
    expect(out.office.size).toEqual({ w: 7, h: 5 });
  });

  it('移行後の形式は、読み込んで書き出しても元に戻る', () => {
    const out = migrate(17, v17);
    expect(importSave(exportSave(out))).toEqual(out);
  });

  it('内側の壁などのない自社オフィスは、移行後も残りの形式を保つ', () => {
    const out = migrate(17, v17);
    expect(out.office).toEqual({ ...v17.office, innerWalls: [], doors: [], annexes: [] });
  });
});


describe('v18 → v19', () => {
  const { mode: _mode, ...v18 } = sample;

  it('遊び方のない移行前のセーブデータは、案件の経営ゲーム（career）になる', () => {
    expect(migrate(18, v18).mode).toBe('career');
  });

  it('サンドボックスのセーブデータは、書き出しと読み込みで遊び方が残る', () => {
    const sandbox: SaveData = { ...sample, mode: 'sandbox' };
    expect(importSave(exportSave(sandbox))).toEqual(sandbox);
  });

  it('遊び方が career・sandbox 以外のセーブデータは拒否する', () => {
    expect(() => migrate(SAVE_VERSION, { ...sample, mode: 'other' })).toThrow();
  });
});

describe('v19 → v20: 機器の対応表（hosts）', () => {
  it('既存の機器には空の対応表を入れる（自社オフィスと案件の両方）', () => {
    const node = { uid: 'n1', device: 'pc_basic', x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [] };
    const v19 = { ...sample, office: { ...sample.office, nodes: [node] }, active: [{ ...sample.active[0], nodes: [node] }] } as unknown;
    const out = migrate(19, v19);
    expect(out.office.nodes[0]).toMatchObject({ uid: 'n1', hosts: [] });
    expect(out.active[0].nodes[0]).toMatchObject({ uid: 'n1', hosts: [] });
  });
});

// 版ごとの架空のセーブ（N19）。版を上げるたびに、その版の形を1つ残す。ここでは v20（依頼に届いた日がない）を残し、v21 まで移行できることを確かめる
describe('古いセーブの読み込み（版ごとの架空のセーブ）', () => {
  it('v20 の依頼は、読み込んだ時刻に届いたものとして v21 になる（期限は付けない）', () => {
    const v20 = {
      ...sample,
      clock: { minute: 2880, money: 300000, paidMonths: 1, bankrupt: false },
      offers: [{ id: 'old', kind: 'template', baseId: 't_small_lan', params: {}, contract: { id: 'x' } }],
    };
    const migrated = migrate(20, v20);
    expect(migrated.offers).toEqual([
      { id: 'old', kind: 'template', baseId: 't_small_lan', params: {}, contract: { id: 'x' }, arrivedMinute: 2880 },
    ]);
  });
});

describe('古いセーブの読み込み（v19）', () => {
  it('v19 の機器には、名前と IP の対応表（hosts）が空で入る', () => {
    const node = { uid: 'pc1', device: 'pc_basic', x: 1, y: 1, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [] };
    const v19 = { ...sample, office: { ...sample.office, nodes: [node] }, active: [] };
    const migrated = migrate(19, v19);
    expect(migrated.office.nodes[0]).toMatchObject({ uid: 'pc1', hosts: [] });
  });
});

describe('保存の中身の検査（依頼の形）', () => {
  it('依頼の形が合わないセーブは拒否する', () => {
    expect(isSaveData({ ...sample, offers: [{ id: 'x', kind: 'other', baseId: 'b', params: {}, contract: {} }] })).toBe(false);
    expect(isSaveData({ ...sample, offers: [{ id: 'x', kind: 'fixed', baseId: 'b', params: {}, contract: {} }] })).toBe(true);
  });
});
