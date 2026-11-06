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
import officeJson from '../assets/data/maps/office_small.json';
import type { Balance, Contract, Furniture, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import type { Service } from '../network/types';
import { initialStaff } from './staff';
import { moveFurniture } from './furniture';
import {
  accept,
  focusedOf,
  moveNode,
  placeDevice,
  placeInOffice,
  replugTo,
  connect,
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

const UTP = 'utp_cat5e';
const cableCost = (length: number, cable = UTP) => cables[cable].pricePerLink + cables[cable].pricePerTile * length;

const offerOf = (contract: unknown, id: string): Offer => ({
  id,
  kind: 'fixed',
  baseId: id,
  params: {},
  contract: contract as Contract,
});

const start = (owned: Record<string, number> = {}): Core => ({
  clock: { minute: 0, money: 1_000_000, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned,
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  offers: [offerOf(c001, 'c001_direct_link')],
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
const reasonOf = (r: { ok: boolean; reason?: string }) => (r.ok ? null : (r.reason ?? null));
const take = (core: Core, id: string) => accept(core, id, balance.office.projectSlots, core.staff.map((s) => s.uid));
const cur = (core: Core) => focusedOf(core)!;

// c001 の設計中。スイッチ u0 を (6,6) に置き、既設の PC 2台（pc_a (3,4)・pc_b (10,4)）をつないだ状態
const wired = (): Core => {
  let core: Core = ok(take({ ...start({ l2_switch_8p: 2 }) }, 'c001_direct_link')).core;
  core = ok(placeDevice(core, 'l2_switch_8p', 6, 6, map, env)).core;
  core = ok(connect(core, 'pc_a', 'u0', UTP, env)).core;
  core = ok(connect(core, 'pc_b', 'u0', UTP, env)).core;
  return core;
};

const linkOf = (core: Core, a: string, b: string) =>
  cur(core).links.find((l) => [l.a.node, l.b.node].includes(a) && [l.a.node, l.b.node].includes(b))!;

// 設計中の案件の施工済みの機器・配線を指定する（施工の結果を作る）
const withBuilt = (core: Core, nodes: string[], links: string[]): Core => {
  const p = cur(core);
  return { ...core, active: core.active.map((x) => (x.id === p.id ? { ...p, built: { nodes, links } } : x)) };
};

describe('機器の移動（moveNode）', () => {
  it('床の別のマスへ移すと、つながるケーブルの経路と費用を引き直し、差額を払う', () => {
    const core = wired();
    const before = cur(core).cost;
    const money = core.clock.money;
    // スイッチを (6,6) から (6,3) へ。pc_a(3,4) との長さは 5 → 4
    const after = ok(moveNode(core, 'u0', 6, 3, env, 'focus', map)).core;
    const link = linkOf(after, 'pc_a', 'u0');
    expect(link.path).toEqual([
      [3, 4],
      [6, 4],
      [6, 3],
    ]);
    // pc_b(10,4) との長さは 6 → 5（u0 につながるもう1本のケーブルも引き直す）
    const delta = cableCost(4) - cableCost(5) + (cableCost(5) - cableCost(6));
    expect(cur(after).cost).toBe(before + delta);
    expect(after.clock.money).toBe(money - delta);
    expect(cur(after).nodes.find((n) => n.uid === 'u0')).toMatchObject({ x: 6, y: 3 });
  });

  it('遠ざけると差額を払い、近づけると費用が返る', () => {
    const core = wired();
    const farther = ok(moveNode(core, 'u0', 8, 8, env, 'focus', map)).core;
    expect(farther.clock.money).toBeLessThan(core.clock.money);
    const back = ok(moveNode(farther, 'u0', 6, 6, env, 'focus', map)).core;
    expect(back.clock.money).toBe(core.clock.money);
    expect(cur(back).cost).toBe(cur(core).cost);
  });

  it('施工済みの機器を動かすと、その機器とつながるケーブルは施工前に戻る', () => {
    const base = wired();
    const core = withBuilt(base, ['pc_a', 'pc_b', 'u0'], [linkOf(base, 'pc_a', 'u0').uid, linkOf(base, 'pc_b', 'u0').uid]);
    const after = ok(moveNode(core, 'u0', 6, 3, env, 'focus', map)).core;
    expect(cur(after).built.nodes).toEqual(['pc_a', 'pc_b']);
    expect(cur(after).built.links).toEqual([]);
  });

  it('既設（locked）の機器は動かせない', () => {
    const core = wired();
    expect(reasonOf(moveNode(core, 'pc_a', 4, 4, env, 'focus', map))).toBe('locked');
  });

  it('壁・ほかの機器・マップの外へは置けない（tile）', () => {
    const core = wired();
    expect(reasonOf(moveNode(core, 'u0', 0, 0, env, 'focus', map))).toBe('tile');
    // pc_b が (10,4) にいる
    expect(reasonOf(moveNode(core, 'u0', 10, 4, env, 'focus', map))).toBe('tile');
    expect(reasonOf(moveNode(core, 'u0', 14, 4, env, 'focus', map))).toBe('tile');
    expect(reasonOf(moveNode(core, 'u0', -1, 4, env, 'focus', map))).toBe('tile');
  });

  it('ケーブルの長さが上限を超えるときは動かせない（cable）', () => {
    const core = wired();
    const short: Env = { ...env, cables: { ...cables, [UTP]: { ...cables[UTP], maxLengthTiles: 4 } } };
    // (6,6) → (8,8) は pc_a(3,4) から長さ 9
    expect(reasonOf(moveNode(core, 'u0', 8, 8, short, 'focus', map))).toBe('cableTooLong');
  });

  it('差額を払えないときは動かせない（money）', () => {
    const core = wired();
    const poor = { ...core, clock: { ...core.clock, money: 0 } };
    expect(reasonOf(moveNode(poor, 'u0', 8, 8, env, 'focus', map))).toBe('money');
  });

  it('自社オフィスの機器も、同じ規則で動かせる。PCは机の上にだけ置ける', () => {
    let core: Core = { ...start({ l2_switch_8p: 1, pc_basic: 1 }) };
    core = ok(placeInOffice(core, 'pc_basic', 3, 3, map, env)).core;
    core = ok(placeInOffice(core, 'l2_switch_8p', 8, 7, map, env)).core;
    const pc = core.office.nodes[0];
    expect(reasonOf(moveNode(core, pc.uid, 4, 3, env, 'office', map))).toBe('desk');
    const moved = ok(moveNode(core, pc.uid, 6, 3, env, 'office', map)).core;
    expect(moved.office.nodes[0]).toMatchObject({ x: 6, y: 3 });
  });
});

describe('家具の移動（moveFurniture）', () => {
  it('机を床の空いているマスへ動かせる', () => {
    const after = ok(moveFurniture(start(), 'f0', 4, 6, map)).core;
    expect(after.office.furniture.find((f) => f.uid === 'f0')).toMatchObject({ x: 4, y: 6, id: 'desk' });
    // 並び順（社員の席の順）は変えない
    expect(after.office.furniture.map((f) => f.uid)).toEqual(['f0', 'f1']);
  });

  it('ほかの家具・壁・機器のマスへは動かせない（tile）', () => {
    const core = start();
    expect(reasonOf(moveFurniture(core, 'f0', 6, 3, map))).toBe('tile');
    expect(reasonOf(moveFurniture(core, 'f0', 0, 0, map))).toBe('tile');
    const withNode = ok(placeInOffice(start({ router_basic: 1 }), 'router_basic', 5, 5, map, env)).core;
    expect(reasonOf(moveFurniture(withNode, 'f0', 5, 5, map))).toBe('tile');
  });

  it('机の上に機材があるときは動かせない（occupied）', () => {
    const core = ok(placeInOffice(start({ pc_basic: 1 }), 'pc_basic', 3, 3, map, env)).core;
    expect(reasonOf(moveFurniture(core, 'f0', 4, 6, map))).toBe('occupied');
  });
});

describe('ケーブルの端の挿し替え（replugTo）', () => {
  it('相手の機器を変えられる。費用は新しい長さで引き直す', () => {
    const core = wired();
    const link = linkOf(core, 'pc_a', 'u0');
    // u1 を (6,1) に置き、ケーブルの u0 側の端を u1 へ移す（pc_a との長さは 5 → 6）
    let c2 = ok(placeDevice(core, 'l2_switch_8p', 6, 1, map, env)).core;
    const u1 = cur(c2).nodes.find((n) => n.x === 6 && n.y === 1)!.uid;
    const after = ok(replugTo(c2, link.uid, 'b', u1, null, env, 'focus')).core;
    const moved = linkOf(after, 'pc_a', u1);
    expect(moved.b).toEqual({ node: u1, port: 0 });
    expect(moved.path).toEqual([
      [3, 4],
      [6, 4],
      [6, 1],
    ]);
    expect(cur(after).cost).toBe(cur(c2).cost + cableCost(6) - cableCost(5));
    expect(after.clock.money).toBe(c2.clock.money - (cableCost(6) - cableCost(5)));
  });

  it('相手の機器に空きがなければ失敗する（port）。番号を指定して埋まっていれば portUsed', () => {
    const core = wired();
    const link = linkOf(core, 'pc_a', 'u0');
    // pc_b は1つしかポートがなく、もう使っている
    expect(replugTo(core, link.uid, 'b', 'pc_b', null, env, 'focus')).toEqual({ ok: false, reason: 'port' });
    expect(reasonOf(replugTo(core, link.uid, 'b', 'pc_b', 0, env, 'focus'))).toBe('portUsed');
  });

  it('同じ機器の別のポートへ、おまかせで挿せる（この端の今のポートは空きとして数えない）', () => {
    const core = wired();
    const link = linkOf(core, 'pc_a', 'u0');
    const after = ok(replugTo(core, link.uid, 'b', 'u0', null, env, 'focus')).core;
    expect(linkOf(after, 'pc_a', 'u0').b).toEqual({ node: 'u0', port: 2 });
  });

  it('ケーブルの反対側と同じ機器へは挿せない（none）', () => {
    const core = wired();
    const link = linkOf(core, 'pc_a', 'u0');
    expect(reasonOf(replugTo(core, link.uid, 'b', 'pc_a', null, env, 'focus'))).toBe('none');
  });

  it('挿し替えたケーブルは施工前に戻る', () => {
    const base = wired();
    const link = linkOf(base, 'pc_a', 'u0');
    const core = withBuilt(base, ['pc_a', 'pc_b', 'u0'], [link.uid]);
    let c2 = ok(placeDevice(core, 'l2_switch_8p', 6, 1, map, env)).core;
    const u1 = cur(c2).nodes.find((n) => n.x === 6 && n.y === 1)!.uid;
    const after = ok(replugTo(c2, link.uid, 'b', u1, null, env, 'focus')).core;
    expect(cur(after).built.links).toEqual([]);
  });
});
