import { EMPTY_FAMILIARITY } from './familiar';
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';


import furnitureJson from '../assets/data/furniture.json';



import c001 from '../assets/data/contracts/c001_direct_link.json';
import c004 from '../assets/data/contracts/c004_web_server.json';
import i002 from '../assets/data/contracts/i002_office_server.json';
import officeJson from '../assets/data/maps/office_small.json';
import type { Balance, Contract, Furniture, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';

import { evaluateContract } from '../network/goals';
import { analyze } from '../network/engine/analyze';
import { initialStaff } from './staff';
import { autoAssign } from './autoAssign';
import { connect, focusedOf, stateOfProject, type Core, type Env } from './project';
import { accept, advanceBuild, requestBuild, testDesign } from './progress';
import { placeDevice, placeInOffice, replug, swapPlugs } from './placement';
import { setInterface, setService, setPlan } from './netEdit';

const balance = balanceJson as unknown as Balance;
const map = officeJson as unknown as GameMap;

// 機材の定義（サーバーの defaultServices を含む）
const env: Env = {
  balance,
  furniture: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
  engine: { wallAt: () => false, interferers: [] },
};

const offerOf = (contract: unknown, id: string): Offer => ({
  id,
  kind: 'fixed',
  baseId: id,
  params: {},
  contract: contract as Contract,
});

const start = (): Core => ({
  clock: { minute: 0, money: 1_000_000, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
  offers: [offerOf(c001, 'c001_direct_link'), offerOf(i002, 'i002_office_server'), offerOf(c004, 'c004_web_server')],
  active: [],
  focus: null,
  office: { bought: ['wood' as const], plans: {},
    size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [],
    nodes: [],
    links: [],
    seq: 0,
    furniture: [
      { uid: 'f0', id: 'desk', x: 3, y: 3 },
      { uid: 'f1', id: 'desk', x: 6, y: 3 },
    ],
    furnitureSeq: 2,
  },
  effects: { buildSpeed: 0 },
  staff: initialStaff(balance, 1).staff,
  staffSeq: 2,
  candidates: [],
  guidesDone: [],
  guidesHidden: [],
  termsShown: [],
});

const ok = <T extends { ok: boolean }>(r: T): T & { ok: true } => {
  if (!r.ok) throw new Error(`失敗: ${(r as { reason?: string }).reason}`);
  return r as T & { ok: true };
};
const take = (core: Core, id: string) => accept(core, id, balance.office.projectSlots, core.staff.map((s) => s.uid));
const cur = (core: Core) => focusedOf(core)!;
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? null : (r.reason ?? null));

describe('ポートの挿し替え（replug）', () => {
  // 在庫のスイッチを床に置き、PC2台をスイッチへつないだ c001 の設計中の状態
  const wiredToSwitch = (): Core => {
    let core: Core = { ...ok(take({ ...start(), owned: { l2_switch_8p: 1 } }, 'c001_direct_link')).core };
    core = ok(placeDevice(core, 'l2_switch_8p', 6, 6, map, env)).core;
    core = ok(connect(core, 'pc_a', 'u0', 'utp_cat5e', env)).core;
    core = ok(connect(core, 'pc_b', 'u0', 'utp_cat5e', env)).core;
    return core;
  };

  it('スイッチ側の端を空いているポートへ挿し替えられる', () => {
    const core = wiredToSwitch();
    const linkUid = cur(core).links[0].uid;
    const after = ok(replug(core, linkUid, 'b', 3, env)).core;
    const link = cur(after).links.find((l) => l.uid === linkUid)!;
    expect(link.b).toEqual({ node: 'u0', port: 3 });
    expect(link.a).toEqual({ node: 'pc_a', port: 0 });
  });

  it('埋まったポートには挿せない（portUsed）', () => {
    const core = wiredToSwitch();
    const linkUid = cur(core).links[0].uid;
    // 2本目の配線はスイッチのポート1
    expect(replug(core, linkUid, 'b', 1, env)).toEqual({ ok: false, reason: 'portUsed' });
  });

  it('同じポートへの挿し替えは拒む（自分のケーブルが埋めている）', () => {
    const core = wiredToSwitch();
    const linkUid = cur(core).links[0].uid;
    expect(replug(core, linkUid, 'b', 0, env)).toEqual({ ok: false, reason: 'portUsed' });
  });

  it('機材のポートの数を超える番号には挿せない（port）', () => {
    const core = wiredToSwitch();
    const linkUid = cur(core).links[0].uid;
    expect(replug(core, linkUid, 'b', 8, env)).toEqual({ ok: false, reason: 'port' });
    // PCのポートは1つだけ
    expect(replug(core, linkUid, 'a', 1, env)).toEqual({ ok: false, reason: 'port' });
  });

  it('挿し替えても費用は変わらない', () => {
    const core = wiredToSwitch();
    const linkUid = cur(core).links[0].uid;
    const after = ok(replug(core, linkUid, 'b', 5, env)).core;
    expect(cur(after).cost).toBe(cur(core).cost);
    expect(after.clock.money).toBe(core.clock.money);
  });
});

describe('口の入れ替え（swapPlugs）', () => {
  // 在庫のスイッチを床に置き、PC2台をスイッチの口 0 と 1 へつないだ c001 の設計中の状態
  const wiredToSwitch = (device = 'l2_switch_8p'): Core => {
    let core: Core = { ...ok(take({ ...start(), owned: { [device]: 1 } }, 'c001_direct_link')).core };
    core = ok(placeDevice(core, device, 6, 6, map, env)).core;
    core = ok(connect(core, 'pc_a', 'u0', 'utp_cat5e', env)).core;
    core = ok(connect(core, 'pc_b', 'u0', 'utp_cat5e', env)).core;
    return core;
  };
  const portOf = (core: Core, pc: string) => {
    const link = cur(core).links.find((l) => l.a.node === pc || l.b.node === pc)!;
    return link.a.node === 'u0' ? link.a.port : link.b.port;
  };

  it('2つの口の配線の口を入れ替える（口 0 の配線は口 1 へ、口 1 の配線は口 0 へ）', () => {
    const core = wiredToSwitch();
    expect(portOf(core, 'pc_a')).toBe(0);
    const after = ok(swapPlugs(core, 'u0', 0, 1, env)).core;
    expect(portOf(after, 'pc_a')).toBe(1);
    expect(portOf(after, 'pc_b')).toBe(0);
  });

  it('入れ替えても長さと費用は変わらない', () => {
    const core = wiredToSwitch();
    const after = ok(swapPlugs(core, 'u0', 0, 1, env)).core;
    expect(cur(after).cost).toBe(cur(core).cost);
    expect(after.clock.money).toBe(core.clock.money);
  });

  it('口の種類が合わなければ拒否する（cable.port_type）。RJ45 の配線と、光ファイバーの口（sfp）を入れ替えない', () => {
    // l3_switch は口 0〜7 が rj45、口 8・9 が sfp。u0 の口 8 は、もう1台の l3_switch(u1) へ光ファイバーでつなぐ
    let core: Core = { ...ok(take({ ...start(), owned: { l3_switch: 2 } }, 'c001_direct_link')).core };
    core = ok(placeDevice(core, 'l3_switch', 6, 6, map, env)).core;
    core = ok(placeDevice(core, 'l3_switch', 6, 1, map, env)).core;
    const u0 = cur(core).nodes.find((n) => n.x === 6 && n.y === 6)!.uid;
    const u1 = cur(core).nodes.find((n) => n.x === 6 && n.y === 1)!.uid;
    core = ok(connect(core, 'pc_a', u0, 'utp_cat5e', env)).core;
    core = ok(connect(core, u0, u1, 'fiber_sm', env, 'focus', { a: 8, b: 8 })).core;
    expect(reasonOf(swapPlugs(core, u0, 0, 8, env))).toBe('cable.port_type');
  });

  it('同じ口・範囲外の口は拒否する', () => {
    const core = wiredToSwitch();
    expect(reasonOf(swapPlugs(core, 'u0', 0, 0, env))).toBe('portUsed');
    expect(reasonOf(swapPlugs(core, 'u0', 0, 8, env))).toBe('port');
  });

  it('既設の配線は入れ替えない（locked）', () => {
    const base = wiredToSwitch();
    const pcA = cur(base).links.find((l) => l.a.node === 'pc_a' || l.b.node === 'pc_a')!;
    const core: Core = { ...base, active: base.active.map((p) => ({ ...p, inheritedLinks: [pcA.uid] })) };
    expect(reasonOf(swapPlugs(core, 'u0', 0, 1, env))).toBe('locked');
  });
});

describe('サービスの起動と停止（setService）', () => {
  // i002（自社のサーバー）。PC（u0）とサーバー（u1）を直接つなぎ、置いたサーバーは HTTP を起動した状態
  const officeServer = (): Core => {
    let core: Core = { ...start(), owned: { pc_basic: 1, server_basic: 1 } };
    core = ok(take(core, 'i002_office_server')).core;
    core = ok(placeDevice(core, 'pc_basic', 3, 3, map, env)).core;
    core = ok(placeDevice(core, 'server_basic', 6, 6, map, env)).core;
    return core;
  };

  it('置いたサーバーは HTTP（80）が起動している', () => {
    const core = officeServer();
    const server = cur(core).nodes.find((n) => n.uid === 'u1')!;
    expect(server.services).toEqual([{ protocol: 'http', port: 80 }]);
    const pc = cur(core).nodes.find((n) => n.uid === 'u0')!;
    expect(pc.services).toEqual([]);
  });

  it('停止すると HTTP の判定が不合格になり、起動すると合格になる', () => {
    let core = officeServer();
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env)).core;
    core = ok(setPlan(core, 'u0', 0, '192.168.1.0', 24, env)).core;
    core = autoAssign(core, env, 'focus', true);
    const contract = i002 as unknown as Contract;
    const passed = (c: Core) => evaluateContract(contract, stateOfProject(cur(c), env)).passed;
    expect(passed(core)).toBe(true);
    core = ok(setService(core, 'u1', 'http', false)).core;
    expect(cur(core).nodes.find((n) => n.uid === 'u1')!.services).toEqual([]);
    expect(passed(core)).toBe(false);
    core = ok(setService(core, 'u1', 'http', true)).core;
    expect(cur(core).nodes.find((n) => n.uid === 'u1')!.services).toEqual([{ protocol: 'http', port: 80 }]);
    expect(passed(core)).toBe(true);
  });

  it('固定の機器（案件で設定が固定されたサーバー）のサービスは変えられない', () => {
    const core = ok(take(start(), 'c004_web_server')).core;
    expect(setService(core, 'web', 'http', false)).toEqual({ ok: false, reason: 'locked' });
  });
});

describe('サーバーを置いて配線しIPを設定すると HTTP に合格する（i002 を合格まで進める）', () => {
  it('施工を終えると、i002 の検収に合格して納品される', () => {
    let core: Core = { ...start(), owned: { pc_basic: 1, server_basic: 1 } };
    core = ok(take(core, 'i002_office_server')).core;
    core = ok(placeDevice(core, 'pc_basic', 3, 3, map, env)).core;
    core = ok(placeDevice(core, 'server_basic', 6, 6, map, env)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env)).core;
    core = ok(setPlan(core, 'u0', 0, '192.168.1.0', 24, env)).core;
    core = ok(setInterface(core, 'u1', 0, '192.168.1.10', 24, env)).core;
    core = ok(setInterface(core, 'u0', 0, '192.168.1.11', 24, env)).core;
    expect(analyze({ nodes: cur(core).nodes, links: cur(core).links, plans: cur(core).plans }, env.engine).addressing.issues).toEqual({});
    const tested = testDesign(core, env);
    if (!tested.ok || !tested.result.passed) throw new Error('テストに合格しない');
    core = ok(requestBuild(tested.core, env)).core;
    let r = ok(advanceBuild(core, env, balance.build.workStartHour));
    for (let i = 0; i < 40 && !r.report; i++) r = ok(advanceBuild(r.core, env, balance.build.workStartHour));
    expect(r.report?.passed).toBe(true);
    expect(r.report?.delivered).toBeDefined();
  });
});

describe('機材の初期のサービス', () => {
  it('自社オフィスに置いたサーバーも起動している', () => {
    const core = ok(placeInOffice({ ...start(), owned: { server_basic: 1 } }, 'server_basic', 6, 6, map, env)).core;
    expect(core.office.nodes[0].services).toEqual([{ protocol: 'http', port: 80 }]);
  });
});
