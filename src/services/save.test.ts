import { EMPTY_FAMILIARITY } from '../sim/familiar';
import { describe, expect, it } from 'vitest';
import { SAVE_VERSION, isSaveData, migrate, type SaveData } from './migrations';
import type { Staff } from '../data/schema';
import { exportSave, importSave } from './saveFile';

const member = (uid: string): Staff => ({
  shift: 'day',
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
  hiredMonth: 0,
  leaving: false,
  desk: null,
  levelCap: 10,
});

const sample: SaveData = {
  mode: 'career',
  name: 'テスト社',
  clock: { minute: 720, money: 300000, paidMonths: 1, bankrupt: false, ledger: [] },
  companyExp: 2,
  reputation: 0,
  expDay: 0,
  expToday: 0,
  owned: { pc_basic: 1 },
  completed: ['c001_direct_link'],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  offers: [],
  nextOfferMinute: 0,
  offerSeq: 0,
  newArrivals: {},
  rng: 1,
  active: [],
  focus: null,
  office: { bought: ['wood' as const], segments: {}, size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [], furnitureSeq: 0 },
  effects: { buildSpeed: 0 },
  staff: [member('s0'), member('s1')],
  staffSeq: 2,
  candidates: [],
  guidesDone: ['c001_direct_link'],
};

// v21 までの形（評判 reputation）。古い版から移行するテストの入力に使う
const legacySample = (({ companyExp, ...rest }: SaveData) => ({ ...rest, reputation: companyExp }))(sample) as unknown as SaveData;

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
  const { staff: _staff, staffSeq: _seq, ...withoutStaff } = legacySample;
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
  const { staff: _staff, staffSeq: _seq, ...withoutStaff } = legacySample;
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
  const { active: _active, focus: _focus, ...withoutActive } = legacySample;

  it('単独の案件は一覧にし、その案件を設計の対象にする', () => {
    const project = { id: 'c001_direct_link', nodes: [], links: [], contract: { inhouse: false } };
    const out = migrate(8, { ...withoutActive, active: project });
    expect(out.active).toMatchObject([{ ...project, due: null, crew: ['s0', 's1'], testedOk: false, segments: {}, inheritedLinks: [] }]);
    expect(out.focus).toBe('c001_direct_link');
  });

  it('案件がなければ一覧は空で、設計の対象もない', () => {
    const out = migrate(8, { ...withoutActive, active: null });
    expect(out.active).toEqual([]);
    expect(out.focus).toBeNull();
  });
});

describe('v9 → v10', () => {
  const { active: _active, focus: _focus, ...withoutActive } = legacySample;

  it('受注中の案件に期日がなければ、期日のない案件として扱う', () => {
    const project = { id: 'c001_direct_link', nodes: [], links: [], contract: { inhouse: false } };
    const out = migrate(9, { ...withoutActive, active: [project], focus: 'c001_direct_link' });
    expect(out.active[0]).toMatchObject({ id: 'c001_direct_link', nodes: [], due: null, crew: ['s0', 's1'], testedOk: false, inheritedLinks: [] });
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
      ...legacySample,
      active: { nodes: [node('a', '192.168.1.10'), node('b', '192.168.1.11'), node('c', '192.168.2.10')], links: [], contract: { inhouse: false } },
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
      ...legacySample,
      active: [
        {
          id: 'x',
          nodes: [pc('pc_a', 0, 1), pc('pc_b', 1, 1), router],
          contract: { inhouse: false },
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
    expect(a.interfaces).toEqual([{ id: "eth0", kind: "port", port: 0, ip: '192.168.101.11', prefix: 24 }]);
    expect(a.gateway).toBe('192.168.101.1');
    expect(b.interfaces).toEqual([{ id: "eth0", kind: "port", port: 0, ip: '192.168.101.12', prefix: 24 }]);
    expect(b.gateway).toBeNull();
    expect(r.interfaces).toEqual([{ id: "g0/0", kind: "port", port: 0, ip: '192.168.101.1', prefix: 24 }]);
    expect(out.active[0].segments).toEqual({ 'pc_a:0': { network: '192.168.101.0', prefix: 24 } });
    expect([a, b, r].some((n) => 'colors' in n)).toBe(false);
  });

  it('色を持たない案件は、そのまま残す', () => {
    const v12 = { ...legacySample, active: [{ id: 'x', nodes: [], links: [], contract: { inhouse: false } }] };
    expect(migrate(12, v12).active[0]).toMatchObject({ id: 'x', nodes: [], links: [], testedOk: false });
  });
});

describe('v15 → v16', () => {
  const { guidesDone: _guidesDone, ...v15 } = legacySample;

  it('初めての概念の案内を終えた案件は、移行前は空のまま（どの案件の案内も終えていない）', () => {
    const out = migrate(15, v15);
    expect(out.guidesDone).toEqual([]);
  });

  it('移行後の形式は、読み込んで書き出しても元に戻る', () => {
    const out = migrate(15, v15);
    expect(importSave(exportSave(out))).toEqual(out);
  });

  it('guidesDone が文字列の配列でなければ拒否する', () => {
    expect(() => migrate(16, { ...legacySample, guidesDone: [1] })).toThrow();
  });
});

describe('v14 → v15', () => {
  const { active: _active, focus: _focus, ...withoutActive } = legacySample;

  it('受注中の案件は、テストに合格していないものとして扱う（testedOk: false）', () => {
    const project = { id: 'c001_direct_link', nodes: [], links: [], contract: { inhouse: false } };
    const out = migrate(14, { ...withoutActive, active: [project], focus: 'c001_direct_link' });
    expect(out.active).toMatchObject([{ ...project, testedOk: false, inheritedLinks: [] }]);
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
  const { active: _active, office: _office, ...withoutNet } = legacySample;

  it('サービスが空のサーバーに、機材の既定のサービス（HTTP 80）を入れる。自社オフィスと受注中の案件の両方', () => {
    const v13 = {
      ...withoutNet,
      office: { ...legacySample.office, nodes: [node('o_srv', 'server_basic')] },
      active: [{ id: 'x', nodes: [node('a_srv', 'server_basic')], links: [], contract: { inhouse: false } }],
    };
    const out = migrate(13, v13);
    expect(out.office.nodes[0].services).toEqual([{ protocol: 'http', port: 80 }]);
    expect(out.active[0].nodes[0].services).toEqual([{ protocol: 'http', port: 80 }]);
  });

  it('設定を変えられない（configLocked）サーバーは変えない', () => {
    const v13 = {
      ...withoutNet,
      office: { ...legacySample.office, nodes: [node('o_srv', 'server_basic', { configLocked: true })] },
      active: [{ id: 'x', nodes: [node('a_srv', 'server_basic', { configLocked: true })], links: [], contract: { inhouse: false } }],
    };
    const out = migrate(13, v13);
    expect(out.office.nodes[0].services).toEqual([]);
    expect(out.active[0].nodes[0].services).toEqual([]);
  });

  it('サーバー以外の機器や、サービスが既にあるサーバーは変えない', () => {
    const pc = node('o_pc', 'pc_basic');
    const busy = node('o_srv', 'server_basic', { services: [{ protocol: 'http', port: 8080 }] });
    const v13 = { ...withoutNet, office: { ...legacySample.office, nodes: [pc, busy] }, active: [] };
    const out = migrate(13, v13);
    // 対応表（hosts）は v19 → v20 で空の配列が入る
    expect(out.office.nodes[0]).toEqual({ ...pc, hosts: [], hostname: 'PC-1', macSerial: 1, ports: [] });
    expect(out.office.nodes[1].services).toEqual([{ protocol: 'http', port: 8080 }]);
  });
});

describe('v16 → v17', () => {
  const { office: _office, ...withoutOffice } = legacySample;
  const v16 = { ...withoutOffice, office: { nodes: [], links: [], seq: 0, furniture: [], furnitureSeq: 0 } };

  it('自社オフィスの部屋の大きさは、移行前の固定のマップ（14×8）とする', () => {
    const out = migrate(16, v16);
    expect(out.office.size).toEqual({ w: 14, h: 8 });
  });

  it('部屋の大きさを足したほかは、そのまま残す', () => {
    const out = migrate(16, v16);
    expect(out.office).toMatchObject({ ...v16.office, size: { w: 14, h: 8 }, innerWalls: [], doors: [], annexes: [] });
  });

  it('移行後の形式は、読み込んで書き出しても元に戻る', () => {
    const out = migrate(16, v16);
    expect(importSave(exportSave(out))).toEqual(out);
  });

  it('部屋の大きさがない自社オフィスは拒否する', () => {
    const { size: _size, ...officeWithoutSize } = legacySample.office;
    expect(() => migrate(17, { ...legacySample, office: officeWithoutSize })).toThrow();
  });
});

describe('v17 → v18', () => {
  const { office: _office, ...withoutOffice } = legacySample;
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
    expect(out.office).toMatchObject({ ...v17.office, innerWalls: [], doors: [], annexes: [] });
  });
});


describe('v18 → v19', () => {
  const { mode: _mode, ...v18 } = legacySample;

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
    const v19 = { ...legacySample, office: { ...legacySample.office, nodes: [node] }, active: [{ id: 'p', nodes: [node], links: [], contract: { inhouse: false } }] } as unknown;
    const out = migrate(19, v19);
    expect(out.office.nodes[0]).toMatchObject({ uid: 'n1', hosts: [] });
    expect(out.active[0].nodes[0]).toMatchObject({ uid: 'n1', hosts: [] });
  });
});

// 版ごとの架空のセーブ（N19）。版を上げるたびに、その版の形を1つ残す。ここでは v20（依頼に届いた日がない）を残し、v21 まで移行できることを確かめる
describe('古いセーブの読み込み（版ごとの架空のセーブ）', () => {
  it('v20 の依頼は、読み込んだ時刻に届いたものとして v21 になる（期限は付けない）', () => {
    const v20 = {
      ...legacySample,
      clock: { minute: 2880, money: 300000, paidMonths: 1, bankrupt: false, ledger: [] },
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
    const v19 = { ...legacySample, office: { ...legacySample.office, nodes: [node] }, active: [] };
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

describe('古いセーブの読み込み（v21 の評判）', () => {
  it('v21 の評判は、会社の経験値（companyExp）として同じ値で読み込める', () => {
    const { companyExp: _drop, ...rest } = legacySample;
    const v21 = { ...rest, reputation: 5 };
    expect(migrate(21, v21).companyExp).toBe(5);
  });
});

describe('古いセーブの読み込み（v22 の社員）', () => {
  it('v22 の社員と候補は、日勤として v23 になる', () => {
    const { shift: _s, ...noShift } = member('s0');
    const v22 = { ...legacySample, companyExp: 0, staff: [noShift], candidates: [noShift] } as unknown as SaveData;
    const migrated = migrate(22, v22);
    expect(migrated.staff[0].shift).toBe('day');
    expect(migrated.candidates[0].shift).toBe('day');
  });
});

describe('評判（N55）', () => {
  it('v23 の保存は評判を 0 から始めて読み込める（検収の★は残っていない）', () => {
    const { reputation: _r, ...v23 } = sample;
    expect(migrate(23, v23).reputation).toBe(0);
  });
});

describe('v33 → v34', () => {
  // 移行前の社員（採用の月と退職の予定がない形）
  const strip = (m: Staff) => {
    const { hiredMonth: _hiredMonth, leaving: _leaving, ...rest } = m;
    return rest;
  };
  const v33 = { ...sample, staff: sample.staff.map(strip), candidates: sample.candidates.map(strip) };

  it('社員と候補に、採用の月0と退職の予定なしを足す（移行前の社員は、いつでも退職させられる）', () => {
    const out = migrate(33, v33);
    expect(out.staff.every((m) => m.hiredMonth === 0 && m.leaving === false)).toBe(true);
    expect(out.candidates.every((m) => m.hiredMonth === 0 && m.leaving === false)).toBe(true);
  });

  it('移行後の形式は、読み込んで書き出しても元に戻る', () => {
    const out = migrate(33, v33);
    expect(importSave(exportSave(out))).toEqual(out);
  });
});

describe('v34 → v35', () => {
  // 移行前は、社員の並び順で机に座っていた（机の並び順と同じ）
  const desk = (uid: string, x: number) => ({ uid, id: 'desk', x, y: 1 });
  const v34 = {
    ...sample,
    office: { ...sample.office, furniture: [desk('fa', 1), desk('fb', 2)] },
    staff: [member('s0'), member('s1'), member('s2')].map(({ desk: _desk, ...m }) => m),
    candidates: sample.candidates.map(({ desk: _desk, ...m }) => m),
  };

  it('社員は、移行前の並び順のとおりに机に座る（机のない社員は、歩き回る社員のまま）', () => {
    const out = migrate(34, v34);
    expect(out.staff.map((m) => m.desk)).toEqual(['fa', 'fb', null]);
  });

  it('移行後の形式は、読み込んで書き出しても元に戻る', () => {
    const out = migrate(34, v34);
    expect(importSave(exportSave(out))).toEqual(out);
  });
});

describe('v36 → v37', () => {
  const strip = (m: Staff) => {
    const { levelCap: _levelCap, ...rest } = m;
    return rest;
  };
  it('社員と候補に、今の level を含む段階の上端を上限として足す（給与と level は変えない）', () => {
    const v36 = { ...sample, staff: [{ ...strip(member('s0')), level: 14 }], candidates: sample.candidates.map(strip) };
    const out = migrate(36, v36);
    expect(out.staff[0]).toMatchObject({ level: 14, levelCap: 20, salary: 200000 });
    expect(out.candidates.every((m) => m.levelCap === 10 || m.levelCap >= m.level)).toBe(true);
  });
});

describe('v39 → v40', () => {
  const { active: _active, office: _office, ...rest } = sample;

  it('欠けた segments と inheritedLinks を埋める。自社案件は、自社オフィスと同じ uid の配線を引き継いだ配線とする', () => {
    const office = { size: { w: 7, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [{ uid: 'o0', cable: 'utp_cat5e', a: { node: 'x', port: 0 }, b: { node: 'y', port: 0 }, path: [], paid: 0 }], seq: 1, furniture: [], furnitureSeq: 0 };
    const inhouse = { id: 'p1', nodes: [], links: [office.links[0], { uid: 'l1', cable: 'utp_cat5e', a: { node: 'x', port: 1 }, b: { node: 'y', port: 1 }, path: [], paid: 0 }], contract: { inhouse: true } };
    const fixed = { id: 'p2', nodes: [], links: [], contract: { inhouse: false } };
    const out = migrate(39, { ...rest, office, active: [inhouse, fixed], focus: null });
    expect(out.active[0]).toMatchObject({ segments: {}, inheritedLinks: ['o0'] });
    expect(out.active[1]).toMatchObject({ segments: {}, inheritedLinks: [] });
    expect(out.office.segments).toEqual({});
  });
});

describe('v41 → v42（社名）', () => {
  const { name: _name, ...noName } = sample;

  it('経営の移行前のセーブには「パケットカンパニー」、サンドボックスには「サンドボックス」を付ける', () => {
    expect(migrate(41, { ...noName, mode: 'career' }).name).toBe('パケットカンパニー');
    expect(migrate(41, { ...noName, mode: 'sandbox' }).name).toBe('サンドボックス');
  });
});

describe('v42 → v43（インターフェースの名前と種類）', () => {
  it('既存のインターフェースに名前（PC は eth、機器は g0/）と種類（port）を付ける', () => {
    const pc = { uid: 'p', device: 'pc_basic', x: 0, y: 0, locked: false, configLocked: false, interfaces: [{ port: 0, ip: '10.0.0.2', prefix: 24 }], gateway: null, routes: [], services: [] };
    const sw = { uid: 's', device: 'router_basic', x: 1, y: 0, locked: false, configLocked: false, interfaces: [{ port: 2, ip: '10.0.0.1', prefix: 24 }], gateway: null, routes: [], services: [] };
    const { active: _a, office: _o, ...rest } = sample;
    const out = migrate(42, { ...rest, active: [], office: { ...sample.office, nodes: [pc, sw] } });
    expect(out.office.nodes[0].interfaces[0]).toMatchObject({ id: 'eth0', kind: 'port', port: 0 });
    expect(out.office.nodes[1].interfaces[0]).toMatchObject({ id: 'g0/2', kind: 'port', port: 2 });
  });
});

describe('v44 → v45（回線終端）', () => {
  it('WAN の口が空いていたルーターに、費用0の回線終端をつなぐ（今までどおり外部へ届く）', () => {
    const router = { uid: 'r', device: 'router_basic', x: 2, y: 3, locked: false, configLocked: false, interfaces: [{ id: 'g0/0', kind: 'port', port: 0, ip: '198.51.100.2', prefix: 24 }, { id: 'g0/1', kind: 'port', port: 1, ip: '192.168.1.1', prefix: 24 }], gateway: null, routes: [], services: [], ports: [] };
    const { active: _a, office: _o, ...rest } = sample;
    const out = migrate(44, { ...rest, active: [], office: { ...sample.office, nodes: [router], links: [] } });
    expect(out.office.nodes.some((n) => n.device === 'uplink')).toBe(true);
    const cable = out.office.links.find((l) => l.a.node === 'r' && l.a.port === 0);
    expect(cable?.b.node).toBe('r_uplink');
    expect(cable?.paid).toBe(0);
  });
});

describe('v45 → v46（光ファイバーは SFP の口だけ）', () => {
  const mk = (uid: string, device: string, x: number) => ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] });
  const fiber = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'fiber_sm', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });
  const { active: _a, office: _o, ...rest } = sample;

  it('両端の L3 スイッチに空いた SFP の口があれば、そこへつなぎ直す', () => {
    const out = migrate(45, { ...rest, active: [], office: { ...sample.office, nodes: [mk('s1', 'l3_switch', 0), mk('s2', 'l3_switch', 2)], links: [fiber('f', 's1', 0, 's2', 0)] } });
    const l = out.office.links[0];
    expect(l.cable).toBe('fiber_sm');
    expect(l.a.port).toBe(8);
    expect(l.b.port).toBe(8);
  });

  it('SFP の口がない機器（PC）につながる光ファイバーは、LAN ケーブルに置き換える', () => {
    const out = migrate(45, { ...rest, active: [], office: { ...sample.office, nodes: [mk('p', 'pc_basic', 0), mk('s1', 'l3_switch', 2)], links: [fiber('f', 'p', 0, 's1', 0)] } });
    expect(out.office.links[0].cable).toBe('utp_cat5e');
  });
});
