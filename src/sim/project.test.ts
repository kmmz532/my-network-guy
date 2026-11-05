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
import { initialStaff } from './staff';
import {
  abandon,
  accept,
  focusedOf,
  advanceBuild,
  checkConnect,
  connect,
  placeDevice,
  placeInOffice,
  removeFromOffice,
  removeLink,
  removeNode,
  setInterface,
  requestBuild,
  setColor,
  type Core,
  type Env,
} from './project';

const balance = balanceJson as unknown as Balance;
const map = officeJson as unknown as GameMap;

const devices: Env['devices'] = {};
for (const d of [...pcJson.devices, ...switchJson.devices, ...routerJson.devices, ...serverJson.devices]) {
  devices[d.id] = {
    category: d.category,
    price: d.price,
    portCount: d.ports.reduce((sum, p) => sum + p.count, 0),
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

const offer: Offer = {
  id: 'c001_direct_link',
  kind: 'fixed',
  baseId: 'c001_direct_link',
  params: {},
  contract: c001 as unknown as Contract,
};

const start = (): Core => ({
  clock: { minute: 0, money: 1_000_000, paidMonths: 0, bankrupt: false },
  reputation: 0,
  owned: {},
  completed: [],
  offers: [offer],
  active: [],
  focus: null,
  // 社員2人は、机に座っている（施工力は1ずつ）
  office: {
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
});

// 案件の受注は枠（balance.office.projectSlots）を渡す
const take = (core: Core, id: string) => accept(core, id, balance.office.projectSlots, core.staff.map((s) => s.uid));
// 設計の対象の案件
const cur = (core: Core) => focusedOf(core);

// 結果が成功していることを確認して、その状態を返す
const ok = (r: ReturnType<typeof accept>) => {
  if (!r.ok) throw new Error(`失敗: ${r.reason}`);
  return r;
};

describe('案件の流れ: c001 PC2台の直結', () => {
  it('色を塗って配線し、施工すると検収に合格して納品される', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    expect(cur(core)?.phase).toBe('design');
    expect(core.offers).toEqual([]);

    core = ok(setColor(core, 'pc_a', 0, 1)).core;
    core = ok(setColor(core, 'pc_b', 0, 1)).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    // 配線費用: 1000 + 300 × 7タイル
    expect(core.clock.money).toBe(1_000_000 - 3100);

    core = ok(requestBuild(core, env)).core;
    expect(cur(core)?.total).toBe(7 * balance.build.minutesPerCableTile);

    // 勤務時間内の1Tickで施工が終わり、検収に合格する
    const done = ok(advanceBuild(core, env, balance.build.workStartHour));
    expect(done.report?.passed).toBe(true);
    expect(done.report?.stars).toBe(3);
    expect(done.core.active).toEqual([]);
    expect(done.core.completed).toEqual(['c001_direct_link']);
    // 報酬は 30000 × ★3 の倍率 1.25
    expect(done.core.clock.money).toBe(1_000_000 - 3100 + 37500);
    expect(done.core.reputation).toBe(1 + 3 * balance.reputationPerStar);
    expect(done.report?.reputationGain).toBe(1 + 3 * balance.reputationPerStar);
  });

  it('色を塗らずに施工すると不合格になり、設計に戻る', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    core = ok(requestBuild(core, env)).core;
    const r = ok(advanceBuild(core, env, balance.build.workStartHour));
    expect(r.report?.passed).toBe(false);
    expect(r.report?.failures.map((f) => f.reason)).toContain('ip.unset');
    expect(cur(r.core)?.phase).toBe('design');
    expect(cur(r.core)?.rework).toBe(1);
    expect(r.core.completed).toEqual([]);
  });

  it('勤務時間外は施工が進まない', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    core = ok(requestBuild(core, env)).core;
    const r = ok(advanceBuild(core, env, 3));
    expect(cur(r.core)?.progress).toBe(0);
    expect(r.report).toBeUndefined();
  });

  it('受注は案件の枠の数まで', () => {
    const core = ok(take(start(), 'c001_direct_link')).core;
    expect(take(core, 'c001_direct_link')).toEqual({ ok: false, reason: 'slots' });
  });
});

describe('複数の案件', () => {
  const second: Offer = { ...offer, id: 'c001_again' };

  it('枠が2つなら2件を受注でき、受注した案件が設計の対象になる', () => {
    const base: Core = { ...start(), offers: [offer, second] };
    const one = ok(accept(base, offer.id, 2, ['s0'])).core;
    const two = ok(accept(one, second.id, 2, ['s1'])).core;
    expect(two.active.map((p) => p.id)).toEqual([offer.id, second.id]);
    expect(two.focus).toBe(second.id);
  });

  it('担当の社員を、別の案件の担当に選ぶと失敗する（crew）', () => {
    const base: Core = { ...start(), offers: [offer, second] };
    const one = ok(accept(base, offer.id, 2, ['s0'])).core;
    expect(accept(one, second.id, 2, ['s0'])).toEqual({ ok: false, reason: 'crew' });
    expect(accept(one, second.id, 2, [])).toEqual({ ok: false, reason: 'crew' });
  });

  it('担当でない社員には、施工の経験値が入らない', () => {
    const base: Core = { ...start(), offers: [offer] };
    let core = ok(accept(base, offer.id, 2, ['s0'])).core;
    core = { ...core, active: core.active.map((p) => ({ ...p, phase: 'build' as const, total: 100000 })) };
    const r = ok(advanceBuild(core, env, balance.build.workStartHour)).core;
    expect(r.staff.find((s) => s.uid === 's0')?.exp).toBeGreaterThan(0);
    expect(r.staff.find((s) => s.uid === 's1')?.exp).toBe(0);
  });

  it('施工中の案件はどちらも進み、対象の案件に関係なく施工の時間が進む', () => {
    const base: Core = { ...start(), offers: [offer, second] };
    let core = ok(accept(ok(accept(base, offer.id, 2, ['s0'])).core, second.id, 2, ['s1'])).core;
    core = {
      ...core,
      active: core.active.map((p) => ({ ...p, phase: 'build' as const, progress: 0, total: 100000 })),
    };
    const r = ok(advanceBuild(core, env, balance.build.workStartHour));
    // 担当は1人ずつなので、施工力は1人ぶん
    expect(r.core.active.map((p) => p.progress)).toEqual([balance.time.gameMinutesPerTick, balance.time.gameMinutesPerTick]);
  });
});

describe('機器の配置と配線', () => {
  it('在庫がないと配置できない', () => {
    const core = ok(take(start(), 'c001_direct_link')).core;
    expect(placeDevice(core, 'l2_switch_8p', 5, 5, map, env)).toEqual({ ok: false, reason: 'stock' });
  });

  it('壁のマスには置けない', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = { ...core, owned: { l2_switch_8p: 1 } };
    expect(placeDevice(core, 'l2_switch_8p', 0, 0, map, env)).toEqual({ ok: false, reason: 'tile' });
  });

  it('配置すると在庫が減る', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = { ...core, owned: { l2_switch_8p: 1 } };
    const r = ok(placeDevice(core, 'l2_switch_8p', 6, 6, map, env));
    expect(r.core.owned.l2_switch_8p).toBe(0);
    expect(cur(r.core)?.nodes.some((n) => n.uid === 'u0' && n.x === 6)).toBe(true);
  });

  it('設定が固定された機器の色は変えられない', () => {
    const core = ok(take(start(), 'c001_direct_link')).core;
    const locked = {
      ...core,
      active: core.active.map((p) => ({ ...p, nodes: p.nodes.map((n) => ({ ...n, configLocked: true })) })),
    };
    expect(setColor(locked, 'pc_a', 0, 2)).toEqual({ ok: false, reason: 'locked' });
  });

  it('ケーブルの上限長を超える配線はできない', () => {
    const core = ok(take(start(), 'c001_direct_link')).core;
    // pc_a (3,4) と pc_b (10,4) は7タイル。上限を超えるケーブルがないため、距離だけ確かめる
    const short = { ...env, cables: { utp_cat5e: { pricePerLink: 0, pricePerTile: 0, maxLengthTiles: 3 } } };
    expect(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', short)).toEqual({ ok: false, reason: 'cable' });
  });
});

describe('配線できるかの判定', () => {
  it('自分自身には配線できない', () => {
    const core = ok(take(start(), 'c001_direct_link')).core;
    expect(checkConnect(core, 'pc_a', 'pc_a', 'utp_cat5e', env)).toBe('none');
  });

  it('できる場合は理由を返さない', () => {
    const core = ok(take(start(), 'c001_direct_link')).core;
    expect(checkConnect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).toBeNull();
  });

  it('PCのポートが埋まっていると配線できない', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    core = { ...core, owned: { l2_switch_8p: 1 } };
    expect(checkConnect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).toBe('port');
  });
});

describe('施工後の撤去と配線のやり直し', () => {
  // 在庫のスイッチを床に置き、既設のPC（pc_a）と配線してから施工する。色を塗らないので不合格になり、設計に戻る
  const failedDesign = (): Core => {
    let core: Core = { ...ok(take({ ...start(), owned: { l2_switch_8p: 1 } }, 'c001_direct_link')).core };
    core = ok(placeDevice(core, 'l2_switch_8p', 6, 6, map, env)).core;
    core = ok(connect(core, 'pc_a', 'u0', 'utp_cat5e', env)).core;
    core = ok(requestBuild(core, env)).core;
    // 施工が終わるまで勤務時間の Tick を進める（検収で不合格になり、設計に戻る）
    let r = ok(advanceBuild(core, env, balance.build.workStartHour));
    for (let i = 0; i < 20 && !r.report; i++) r = ok(advanceBuild(r.core, env, balance.build.workStartHour));
    expect(r.report?.passed).toBe(false);
    return r.core;
  };

  it('不合格で設計に戻った案件で、つながったケーブルごと施工済みの機器を撤去でき、在庫に戻る', () => {
    const core = failedDesign();
    const before = core.owned.l2_switch_8p ?? 0;
    const cableBefore = core.owned.utp_cat5e ?? 0;
    const after = ok(removeNode(core, 'u0')).core;
    expect(cur(after)?.nodes.some((n) => n.uid === 'u0')).toBe(false);
    expect(cur(after)?.links).toEqual([]);
    expect(cur(after)?.built.nodes.includes('u0')).toBe(false);
    expect(after.owned.l2_switch_8p).toBe(before + 1);
    expect(after.owned.utp_cat5e).toBe(cableBefore + 1);
  });

  it('案件の中で、配線だけを撤去できる（ケーブルは在庫に戻る）', () => {
    const core = failedDesign();
    const linkUid = cur(core)!.links[0].uid;
    const after = ok(removeLink(core, linkUid, 'focus', env)).core;
    expect(cur(after)?.links).toEqual([]);
    expect(cur(after)?.nodes.length).toBe(cur(core)?.nodes.length);
    expect(after.owned.utp_cat5e).toBe((core.owned.utp_cat5e ?? 0) + 1);
  });

  it('既設の機器は撤去できない', () => {
    const core = failedDesign();
    const locked = cur(core)!.nodes.find((n) => n.locked);
    if (!locked) throw new Error('既設の機器がない');
    expect(removeNode(core, locked.uid)).toEqual({ ok: false, reason: 'locked' });
  });
});

describe('案件の設計中の配線の撤去（費用の戻し）', () => {
  it('固定の機器どうしを結んだ配線は撤去でき、施工前の費用が戻る', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    expect(cur(core)?.cost).toBe(3100);
    const linkUid = cur(core)!.links[0].uid;
    const after = ok(removeLink(core, linkUid, 'focus', env)).core;
    expect(cur(after)?.links).toEqual([]);
    expect(cur(after)?.cost).toBe(0);
    expect(after.clock.money).toBe(1_000_000);
    expect(after.owned.utp_cat5e).toBe((core.owned.utp_cat5e ?? 0) + 1);
  });

  it('施工済みの配線は撤去しても費用が戻らない', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    const p = cur(core)!;
    const link = p.links[0];
    // 施工済みの状態にする（配線の uid を built に入れる）
    const built: Core = { ...core, active: core.active.map((x) => (x.id === p.id ? { ...x, built: { ...x.built, links: [link.uid] } } : x)) };
    const after = ok(removeLink(built, link.uid, 'focus', env)).core;
    expect(cur(after)?.cost).toBe(3100);
    expect(after.clock.money).toBe(1_000_000 - 3100);
  });

  it('自社案件から引き継いだ配線は撤去できない', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    const p = cur(core)!;
    const link = p.links[0];
    const marked: Core = { ...core, active: core.active.map((x) => (x.id === p.id ? { ...x, inheritedLinks: [link.uid] } : x)) };
    expect(removeLink(marked, link.uid, 'focus', env)).toEqual({ ok: false, reason: 'locked' });
  });
});

describe('自社オフィスのケーブル', () => {
  it('ケーブルのつながったPCを撤去すると、ケーブルも在庫に戻る', () => {
    let core: Core = { ...start(), owned: { pc_basic: 2, l2_switch_8p: 1 }, office: { nodes: [], links: [], seq: 0, furniture: [{ uid: 'a', id: 'desk', x: 3, y: 4 }, { uid: 'b', id: 'desk', x: 8, y: 4 }], furnitureSeq: 2 } };
    core = ok(placeInOffice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeInOffice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env, 'office')).core;
    const after = ok(removeFromOffice(core, 'u0')).core;
    expect(after.office.links).toEqual([]);
    expect(after.owned.utp_cat5e).toBe(1);
    expect(after.owned.pc_basic).toBe(1);
  });
});

describe('自社オフィスの編集', () => {
  const desk = (x: number, y: number) => ({ uid: `f${x}${y}`, id: 'desk', x, y });
  const officeStart = (): Core => ({
    ...start(),
    owned: { pc_basic: 2, l2_switch_8p: 1 },
    office: { nodes: [], links: [], seq: 0, furniture: [desk(3, 4), desk(8, 4)], furnitureSeq: 2 },
  });

  it('自社オフィスでPC2台とスイッチを配線し、IPアドレスを設定できる', () => {
    let core = officeStart();
    core = ok(placeInOffice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeInOffice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(placeInOffice(core, 'l2_switch_8p', 6, 6, map, env)).core;
    core = ok(connect(core, 'u0', 'u2', 'utp_cat5e', env, 'office')).core;
    core = ok(connect(core, 'u1', 'u2', 'utp_cat5e', env, 'office')).core;
    expect(core.office.links).toHaveLength(2);
    core = ok(setInterface(core, 'u0', 0, '192.168.1.10', 24, 'office')).core;
    expect(core.office.nodes.find((n) => n.uid === 'u0')?.interfaces).toEqual([{ port: 0, ip: '192.168.1.10', prefix: 24 }]);
  });

  it('配線は施工を待たず、すぐに自社オフィスに反映される', () => {
    let core = officeStart();
    core = ok(placeInOffice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeInOffice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env, 'office')).core;
    expect(core.office.links).toHaveLength(1);
    expect(core.active).toEqual([]);
  });

  it('配線を撤去すると、ケーブルは在庫に戻る', () => {
    let core = officeStart();
    core = ok(placeInOffice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeInOffice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env, 'office')).core;
    const linkUid = core.office.links[0].uid;
    const removed = ok(removeLink(core, linkUid, 'office', env)).core;
    expect(removed.office.links).toEqual([]);
    expect(removed.owned.utp_cat5e).toBe(1);
  });

  it('自社案件を受注中は、自社オフィスの直接編集が理由 inhouse で失敗する', () => {
    const inhouse: Contract = {
      id: 'i001_office_lan',
      stage: 1,
      order: 15,
      requires: [],
      map: 'office_small',
      budget: 200000,
      placed: [],
      goals: [{ type: 'count', category: 'pc', min: 2 }],
      reward: { money: 0, reputation: 1 },
      inhouse: true,
      effect: { buildSpeed: 0 },
    };
    const offerIn: Offer = { id: inhouse.id, kind: 'fixed', baseId: inhouse.id, params: {}, contract: inhouse };
    const core = { ...officeStart(), offers: [offerIn] };
    const accepted = ok(take(core, inhouse.id)).core;
    expect(setInterface(accepted, 'u0', 0, '192.168.1.10', 24, 'office')).toEqual({ ok: false, reason: 'inhouse' });
    expect(removeLink(accepted, 'l0', 'office', env)).toEqual({ ok: false, reason: 'inhouse' });
  });
});

describe('自社案件', () => {
  const inhouse: Contract = {
    id: 'i001_office_lan',
    stage: 1,
    order: 15,
    requires: [],
    map: 'office_small',
    budget: 200000,
    placed: [],
    goals: [
      { type: 'count', category: 'pc', min: 2 },
      { type: 'ping_all', nodes: '$all_pcs' },
    ],
    reward: { money: 0, reputation: 1 },
    inhouse: true,
    effect: { buildSpeed: 0.2 },
  };
  const inhouseOffer: Offer = { id: inhouse.id, kind: 'fixed', baseId: inhouse.id, params: {}, contract: inhouse };

  const desk = (x: number, y: number) => ({ uid: `f${x}${y}`, id: 'desk', x, y });

  it('自社案件では、机のない床にPCを置けない', () => {
    const core: Core = { ...start(), offers: [inhouseOffer], owned: { pc_basic: 1 } };
    const accepted = ok(take(core, inhouse.id)).core;
    expect(placeDevice(accepted, 'pc_basic', 6, 6, map, env)).toEqual({ ok: false, reason: 'desk' });
  });

  it('自社案件では、机の上にPCを置ける', () => {
    const core: Core = {
      ...start(),
      offers: [inhouseOffer],
      owned: { pc_basic: 1 },
      office: { nodes: [], links: [], seq: 0, furniture: [desk(6, 6)], furnitureSeq: 1 },
    };
    const accepted = ok(take(core, inhouse.id)).core;
    expect(cur(ok(placeDevice(accepted, 'pc_basic', 6, 6, map, env)).core)?.nodes).toHaveLength(1);
  });

  it('自社案件では、家具のマスに機器を置けない', () => {
    const core: Core = {
      ...start(),
      offers: [inhouseOffer],
      owned: { l2_switch_8p: 1 },
      office: { nodes: [], links: [], seq: 0, furniture: [{ uid: 'f0', id: 'plant', x: 6, y: 6 }], furnitureSeq: 1 },
    };
    const accepted = ok(take(core, inhouse.id)).core;
    expect(placeDevice(accepted, 'l2_switch_8p', 6, 6, map, env)).toEqual({ ok: false, reason: 'tile' });
  });

  it('自社案件でない案件では、床にPCを置ける', () => {
    const core: Core = { ...start(), owned: { pc_basic: 1 } };
    const accepted = ok(take(core, offer.id)).core;
    const before = cur(accepted)?.nodes.length ?? 0;
    expect(cur(ok(placeDevice(accepted, 'pc_basic', 6, 6, map, env)).core)?.nodes).toHaveLength(before + 1);
  });

  it('納品したネットワークが自社オフィスに残り、次の自社案件に引き継がれる', () => {
    let core: Core = {
      ...start(),
      offers: [inhouseOffer],
      owned: { pc_basic: 2 },
      office: { nodes: [], links: [], seq: 0, furniture: [desk(3, 4), desk(8, 4)], furnitureSeq: 2 },
    };
    core = ok(take(core, inhouse.id)).core;
    core = ok(placeDevice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeDevice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(setColor(core, 'u0', 0, 1)).core;
    core = ok(setColor(core, 'u1', 0, 1)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env)).core;
    core = ok(requestBuild(core, env)).core;
    let r = ok(advanceBuild(core, env, balance.build.workStartHour));
    for (let i = 0; i < 20 && r.core.active.length > 0; i++) r = ok(advanceBuild(r.core, env, balance.build.workStartHour));
    expect(r.report?.passed).toBe(true);
    expect(r.core.office.nodes.map((n) => n.uid)).toEqual(['u0', 'u1']);
    expect(r.core.office.links).toHaveLength(1);
    expect(r.core.effects.buildSpeed).toBeCloseTo(0.2);

    // 次の自社案件は、残ったネットワークから始まり、uid は重ならない
    const next = ok(take({ ...r.core, offers: [{ ...inhouseOffer, id: 'again' }] }, 'again')).core;
    expect(cur(next)?.nodes.map((n) => n.uid)).toEqual(['u0', 'u1']);
    expect(cur(next)?.seq).toBe(r.core.office.seq);
    // 取り消しても、引き継いだ機器は在庫に戻らない
    expect(ok(abandon(next)).core.owned.pc_basic ?? 0).toBe(0);
  });
});
