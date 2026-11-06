import { EMPTY_FAMILIARITY } from './familiar';
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import cablesJson from '../assets/data/cables.json';
import pcJson from '../assets/data/devices/pc.json';
import furnitureJson from '../assets/data/furniture.json';
import routerJson from '../assets/data/devices/router.json';
import switchJson from '../assets/data/devices/l2_switch.json';
import serverJson from '../assets/data/devices/server.json';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import c004 from '../assets/data/contracts/c004_web_server.json';
import i002 from '../assets/data/contracts/i002_office_server.json';
import officeJson from '../assets/data/maps/office_small.json';
import type { Balance, Contract, Furniture, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import type { Service } from '../network/types';
import { evaluateContract } from '../network/goals';
import { compile } from '../network/compile';
import { initialStaff } from './staff';
import { autoAssign } from './autoAssign';
import {
  accept,
  advanceBuild,
  compiledNet,
  connect,
  focusedOf,
  placeDevice,
  placeInOffice,
  replug,
  requestBuild,
  setInterface,
  setService,
  setSegment,
  testDesign,
  type Core,
  type Env,
} from './project';

const balance = balanceJson as unknown as Balance;
const map = officeJson as unknown as GameMap;

// 機材の定義（サーバーの defaultServices を含む）
const devices: Env['devices'] = {};
for (const d of [...pcJson.devices, ...switchJson.devices, ...routerJson.devices, ...serverJson.devices]) {
  devices[d.id] = {
    category: d.category,
    price: d.price,
    portCount: d.ports.reduce((sum, p) => sum + p.count, 0),
    defaultServices: (d as { defaultServices?: Service[] }).defaultServices ?? [],
  };
}
const cables: Env['cables'] = {};
for (const c of cablesJson.cables) {
  cables[c.id] = { pricePerLink: c.pricePerLink, pricePerTile: c.pricePerTile, maxLengthTiles: c.maxLengthTiles };
}
const env: Env = {
  balance,
  furniture: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
  devices,
  cables,
  engine: {
    categoryOf: (device) => devices[device]?.category ?? 'unknown',
    maxLengthOf: (cable) => cables[cable]?.maxLengthTiles ?? 0,
  },
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
  offers: [offerOf(c001, 'c001_direct_link'), offerOf(i002, 'i002_office_server'), offerOf(c004, 'c004_web_server')],
  active: [],
  focus: null,
  office: {
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
});

const ok = <T extends { ok: boolean }>(r: T): T & { ok: true } => {
  if (!r.ok) throw new Error(`失敗: ${(r as { reason?: string }).reason}`);
  return r as T & { ok: true };
};
const take = (core: Core, id: string) => accept(core, id, balance.office.projectSlots, core.staff.map((s) => s.uid));
const cur = (core: Core) => focusedOf(core)!;

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
    core = ok(setSegment(core, 'u0', 0, '192.168.1.0', 24, env)).core;
    core = autoAssign(core, env, 'focus', true);
    const contract = i002 as unknown as Contract;
    const passed = (c: Core) => evaluateContract(contract, compiledNet(cur(c), env).net, env.engine).passed;
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
    core = ok(setSegment(core, 'u0', 0, '192.168.1.0', 24, env)).core;
    core = ok(setInterface(core, 'u1', 0, '192.168.1.10', 24, env)).core;
    core = ok(setInterface(core, 'u0', 0, '192.168.1.11', 24, env)).core;
    expect(compile({ nodes: cur(core).nodes, links: cur(core).links, segments: cur(core).segments }, env.engine).issues).toEqual({});
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
