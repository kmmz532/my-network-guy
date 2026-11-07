import { EMPTY_FAMILIARITY } from './familiar';
import { keepFocus, type Outcome } from './project';
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
import type { Balance, Contract, Furniture, GameMap, JobId } from '../data/schema';
import type { NetNode } from '../network/types';
import type { Offer } from '../contracts/template';
import { initialStaff } from './staff';
import { autoAssign } from './autoAssign';
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
  setSegment,
  addressCandidates,
  plannedAddressCandidates,
  designIssues,
  requestBuild,
  setGateway,
  setService,
  testDesign,
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
  clock: { minute: 0, money: 1_000_000, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
  offers: [offer],
  active: [],
  focus: null,
  // 社員2人は、机に座っている（施工力は1ずつ）
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
  // 初めの社員は、初めの2つの机に座る（ゲームの開始と同じ）
  staff: initialStaff(balance, 1).staff.map((s, i) => ({ ...s, desk: i === 0 ? 'f0' : i === 1 ? 'f1' : null })),
  staffSeq: 2,
  candidates: [],
  guidesDone: [],
});

// 案件の受注は枠（balance.office.projectSlots）を渡す
const take = (core: Core, id: string) => accept(core, id, balance.office.projectSlots, core.staff.map((s) => s.uid));
// 設計の対象の案件
const cur = (core: Core) => focusedOf(core);
// テストに合格させる（施工は、テストに合格してからでないと依頼できない）
const passTest = (core: Core): Core => {
  const r = testDesign(core, env);
  if (!r.ok) throw new Error(`テストできない: ${r.reason}`);
  if (!r.result.passed) throw new Error('テストに不合格');
  return r.core;
};
// テストに合格した状態にする。テストと検収は同じ判定を使うため、通常の操作では検収で落ちない。
// 検収の不合格のあとの操作を試すために、判定の結果を直接書き換える
const forceTested = (core: Core): Core => ({
  ...core,
  active: core.active.map((p) => (p.id === core.focus ? { ...p, testedOk: true } : p)),
});

// 結果が成功していることを確認して、その状態を返す
const ok = (r: ReturnType<typeof accept>) => {
  if (!r.ok) throw new Error(`失敗: ${r.reason}`);
  return r;
};

describe('案件の流れ: c001 PC2台の直結', () => {
  it('IPアドレスを設定して配線し、施工すると検収に合格して納品される', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    expect(cur(core)?.phase).toBe('design');
    expect(core.offers).toEqual([]);

    core = ok(setInterface(core, 'pc_a', 0, '192.168.1.10', 24, env)).core;
    core = ok(setInterface(core, 'pc_b', 0, '192.168.1.11', 24, env)).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    // 配線費用: 1000 + 300 × 7タイル
    expect(core.clock.money).toBe(1_000_000 - 3100);

    core = ok(requestBuild(passTest(core), env)).core;
    expect(cur(core)?.total).toBe(7 * balance.build.minutesPerCableTile);

    // 勤務時間内の1Tickで施工が終わり、検収に合格する
    const done = ok(advanceBuild(core, env, balance.build.workStartHour));
    expect(done.report?.passed).toBe(true);
    expect(done.report?.stars).toBe(3);
    expect(done.core.active).toEqual([]);
    expect(done.core.completed).toEqual(['c001_direct_link']);
    // 報酬は 45000 × ★3 の倍率 1.25
    expect(done.core.clock.money).toBe(1_000_000 - 3100 + 56250);
    // 経験値は案件の規模で増え、評判は得た★の数（3）だけ増える（N55）
    expect(done.core.reputation).toBe(3);
    expect(done.report?.expGain).toBe(done.core.companyExp);
  });

  it('IPアドレスを設定せずにテストすると不合格になり、施工を依頼できない（untested）', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    const r = testDesign(core, env);
    if (!r.ok) throw new Error(r.reason);
    expect(r.result.passed).toBe(false);
    expect(r.result.goals[0].ok).toBe(false);
    expect(r.result.goals[0].failures.map((f) => f.reason)).toContain('ip.unset');
    expect(cur(r.core)?.testedOk).toBe(false);
    expect(requestBuild(r.core, env)).toEqual({ ok: false, reason: 'untested' });
  });

  it('検収で不合格になると設計に戻り、失敗した機器と理由を残す', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    core = ok(requestBuild(forceTested(core), env)).core;
    const r = ok(advanceBuild(core, env, balance.build.workStartHour));
    expect(r.report?.passed).toBe(false);
    expect(r.report?.failures.map((f) => f.reason)).toContain('ip.unset');
    expect(r.report?.check?.goals[0].ok).toBe(false);
    expect(r.report?.check?.goals[0].failures.map((f) => f.reason)).toContain('ip.unset');
    expect(cur(r.core)?.phase).toBe('design');
    expect(cur(r.core)?.rework).toBe(1);
    expect(cur(r.core)?.testedOk).toBe(false);
    expect(r.core.completed).toEqual([]);
  });

  it('勤務時間外は施工が進まない', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(setInterface(core, 'pc_a', 0, '192.168.1.10', 24, env)).core;
    core = ok(setInterface(core, 'pc_b', 0, '192.168.1.11', 24, env)).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    core = ok(requestBuild(passTest(core), env)).core;
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
      // 職種の一致（1.5倍）を外し、施工力は1人ぶんにする
      active: core.active.map((p) => ({ ...p, phase: 'build' as const, progress: 0, total: 100000, contract: { ...p.contract, jobs: [] } })),
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

  it('設定が固定された機器のIPアドレスは変えられない', () => {
    const core = ok(take(start(), 'c001_direct_link')).core;
    const locked = {
      ...core,
      active: core.active.map((p) => ({ ...p, nodes: p.nodes.map((n) => ({ ...n, configLocked: true })) })),
    };
    expect(setInterface(locked, 'pc_a', 0, '192.168.1.20', 24, env)).toEqual({ ok: false, reason: 'locked' });
  });

  it('ケーブルの上限長を超える配線はできない', () => {
    const core = ok(take(start(), 'c001_direct_link')).core;
    // pc_a (3,4) と pc_b (10,4) は7タイル。上限を超えるケーブルがないため、距離だけ確かめる
    const short = { ...env, cables: { utp_cat5e: { pricePerLink: 0, pricePerTile: 0, maxLengthTiles: 3 } } };
    expect(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', short)).toEqual({ ok: false, reason: 'cableTooLong' });
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

describe('ポートを指定して配線する', () => {
  // c001 の設計中に、在庫のスイッチを床に置く（8ポート）
  const withSwitch = (): { core: Core; sw: string } => {
    let core: Core = ok(take({ ...start(), owned: { l2_switch_8p: 1 } }, 'c001_direct_link')).core;
    core = ok(placeDevice(core, 'l2_switch_8p', 6, 6, map, env)).core;
    const sw = focusedOf(core)!.nodes.find((n) => n.device === 'l2_switch_8p')!.uid;
    return { core, sw };
  };

  it('指定したポートにつながる', () => {
    const { core, sw } = withSwitch();
    const next = ok(connect(core, 'pc_a', sw, 'utp_cat5e', env, 'focus', { b: 3 })).core;
    const link = focusedOf(next)!.links[0];
    expect(link.b).toEqual({ node: sw, port: 3 });
  });

  it('指定がなければ空きの最小番号を使う', () => {
    const { core, sw } = withSwitch();
    const first = ok(connect(core, 'pc_a', sw, 'utp_cat5e', env)).core;
    expect(focusedOf(first)!.links[0].b.port).toBe(0);
    const second = ok(connect(first, 'pc_b', sw, 'utp_cat5e', env)).core;
    expect(focusedOf(second)!.links[1].b.port).toBe(1);
  });

  it('埋まったポートには配線できない', () => {
    const { core, sw } = withSwitch();
    const once = ok(connect(core, 'pc_a', sw, 'utp_cat5e', env, 'focus', { b: 3 })).core;
    expect(connect(once, 'pc_b', sw, 'utp_cat5e', env, 'focus', { b: 3 })).toEqual({ ok: false, reason: 'portUsed' });
    expect(checkConnect(once, 'pc_b', sw, 'utp_cat5e', env, 'focus', { b: 3 })).toBe('portUsed');
  });

  it('機器のポートの数を超える番号は使えない', () => {
    const { core, sw } = withSwitch();
    expect(connect(core, 'pc_a', sw, 'utp_cat5e', env, 'focus', { b: 8 })).toEqual({ ok: false, reason: 'port' });
    expect(connect(core, 'pc_a', sw, 'utp_cat5e', env, 'focus', { b: -1 })).toEqual({ ok: false, reason: 'port' });
  });

  it('PCの唯一のポートを指定して、埋まっていれば拒否する', () => {
    const core = ok(take(start(), 'c001_direct_link')).core;
    const once = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env, 'focus', { a: 0, b: 0 })).core;
    expect(focusedOf(once)!.links[0]).toMatchObject({ a: { port: 0 }, b: { port: 0 } });
    expect(checkConnect(once, 'pc_a', 'pc_b', 'utp_cat5e', env, 'focus', { a: 0 })).toBe('portUsed');
  });
});

describe('施工後の撤去と配線のやり直し', () => {
  // 在庫のスイッチを床に置き、既設のPC（pc_a）と配線してから施工する。IPアドレスを設定しないので不合格になり、設計に戻る
  const failedDesign = (): Core => {
    let core: Core = { ...ok(take({ ...start(), owned: { l2_switch_8p: 1 } }, 'c001_direct_link')).core };
    core = ok(placeDevice(core, 'l2_switch_8p', 6, 6, map, env)).core;
    core = ok(connect(core, 'pc_a', 'u0', 'utp_cat5e', env)).core;
    core = ok(requestBuild(forceTested(core), env)).core;
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
    const after = ok(removeNode(core, 'u0', env)).core;
    expect(cur(after)?.nodes.some((n) => n.uid === 'u0')).toBe(false);
    expect(cur(after)?.links).toEqual([]);
    expect(cur(after)?.built.nodes.includes('u0')).toBe(false);
    expect(after.owned.l2_switch_8p).toBe(before + 1);
    // ケーブルは在庫を持たないため、在庫は増えない
    expect(after.owned.utp_cat5e ?? 0).toBe(cableBefore);
  });

  it('案件の中で、配線だけを撤去できる（ケーブルは在庫に入らない）', () => {
    const core = failedDesign();
    const linkUid = cur(core)!.links[0].uid;
    const after = ok(removeLink(core, linkUid, 'focus', env)).core;
    expect(cur(after)?.links).toEqual([]);
    expect(cur(after)?.nodes.length).toBe(cur(core)?.nodes.length);
    expect(after.owned.utp_cat5e ?? 0).toBe(core.owned.utp_cat5e ?? 0);
  });

  it('既設の機器は撤去できない', () => {
    const core = failedDesign();
    const locked = cur(core)!.nodes.find((n) => n.locked);
    if (!locked) throw new Error('既設の機器がない');
    expect(removeNode(core, locked.uid, env)).toEqual({ ok: false, reason: 'locked' });
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
    expect(after.owned.utp_cat5e ?? 0).toBe(core.owned.utp_cat5e ?? 0);
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

  it('撤去の返金は、配線の時に払った額になる（割引が上がっても下がっても同じ・N113）', () => {
    // 割引 50% で配線（払うのは定価の半分）
    let core: Core = { ...ok(take(start(), 'c001_direct_link')).core, purchaseDiscount: 0.5 };
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    const linkUid = cur(core)!.links[0].uid;
    const paid = cur(core)!.cost;
    expect(paid).toBe(1550);
    // 割引なしに変えてから撤去しても、払った 1550 だけが戻る（定価の 3100 は戻らない）
    const after = ok(removeLink({ ...core, purchaseDiscount: 0 }, linkUid, 'focus', env)).core;
    expect(after.clock.money).toBe(core.clock.money + paid);
    expect(cur(after)?.cost).toBe(0);
  });
});

describe('自社オフィスのケーブル', () => {
  it('ケーブルのつながったPCを撤去すると、ケーブルも一緒に撤去され、在庫には入らない', () => {
    let core: Core = { ...start(), owned: { pc_basic: 2, l2_switch_8p: 1 }, office: { size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [{ uid: 'a', id: 'desk', x: 3, y: 4 }, { uid: 'b', id: 'desk', x: 8, y: 4 }], furnitureSeq: 2 } };
    core = ok(placeInOffice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeInOffice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env, 'office')).core;
    const after = ok(removeFromOffice(core, 'u0', env)).core;
    expect(after.office.links).toEqual([]);
    expect(after.owned.utp_cat5e ?? 0).toBe(0);
    expect(after.owned.pc_basic).toBe(1);
  });
});

describe('自社オフィスの編集', () => {
  const desk = (x: number, y: number) => ({ uid: `f${x}${y}`, id: 'desk', x, y });
  const officeStart = (): Core => ({
    ...start(),
    owned: { pc_basic: 2, l2_switch_8p: 1 },
    office: { size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [desk(3, 4), desk(8, 4)], furnitureSeq: 2 },
  });

  it('自社オフィスでPC2台とスイッチを配線し、IPアドレスを設定できる', () => {
    let core = officeStart();
    core = ok(placeInOffice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeInOffice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(placeInOffice(core, 'l2_switch_8p', 6, 6, map, env)).core;
    core = ok(connect(core, 'u0', 'u2', 'utp_cat5e', env, 'office')).core;
    core = ok(connect(core, 'u1', 'u2', 'utp_cat5e', env, 'office')).core;
    expect(core.office.links).toHaveLength(2);
    core = ok(setInterface(core, 'u0', 0, '192.168.1.10', 24, env, 'office')).core;
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

  it('配線を撤去しても、ケーブルは在庫には入らない', () => {
    let core = officeStart();
    core = ok(placeInOffice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeInOffice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env, 'office')).core;
    const linkUid = core.office.links[0].uid;
    const removed = ok(removeLink(core, linkUid, 'office', env)).core;
    expect(removed.office.links).toEqual([]);
    expect(removed.owned.utp_cat5e ?? 0).toBe(0);
  });

  it('自社案件を受注中は、自社オフィスの直接編集が理由 inhouse で失敗する', () => {
    const inhouse: Contract = {
      id: 'i001_office_lan',
      stage: 1,
      unlockLevel: 1,
      order: 15,
      requires: [],
      map: 'office_small',
      budget: 200000,
      placed: [],
      goals: [{ type: 'count', category: 'pc', min: 2 }],
      reward: { money: 0 },
      inhouse: true,
      effect: { buildSpeed: 0 },
    };
    const offerIn: Offer = { id: inhouse.id, kind: 'fixed', baseId: inhouse.id, params: {}, contract: inhouse };
    const core = { ...officeStart(), offers: [offerIn] };
    const accepted = ok(take(core, inhouse.id)).core;
    expect(setInterface(accepted, 'u0', 0, '192.168.1.10', 24, env, 'office')).toEqual({ ok: false, reason: 'inhouse' });
    expect(removeLink(accepted, 'l0', 'office', env)).toEqual({ ok: false, reason: 'inhouse' });
  });
});

describe('自社案件', () => {
  const inhouse: Contract = {
    id: 'i001_office_lan',
    stage: 1,
    unlockLevel: 1,
    order: 15,
    requires: [],
    map: 'office_small',
    budget: 200000,
    placed: [],
    goals: [
      { type: 'count', category: 'pc', min: 2 },
      { type: 'ping_all', nodes: '$all_pcs' },
    ],
    reward: { money: 0 },
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
      office: { size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [desk(6, 6)], furnitureSeq: 1 },
    };
    const accepted = ok(take(core, inhouse.id)).core;
    expect(cur(ok(placeDevice(accepted, 'pc_basic', 6, 6, map, env)).core)?.nodes).toHaveLength(1);
  });

  it('自社案件では、家具のマスに機器を置けない', () => {
    const core: Core = {
      ...start(),
      offers: [inhouseOffer],
      owned: { l2_switch_8p: 1 },
      office: { size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [{ uid: 'f0', id: 'plant', x: 6, y: 6 }], furnitureSeq: 1 },
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

  it('自社案件の納品で、報酬の機器がインベントリに入る（N34）', () => {
    const rewarded: Offer = { ...inhouseOffer, contract: { ...inhouse, reward: { ...inhouse.reward, devices: [{ device: 'l2_switch_8p', count: 1 }] } } };
    let core: Core = {
      ...start(),
      offers: [rewarded],
      owned: { pc_basic: 2 },
      office: { size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [desk(3, 4), desk(8, 4)], furnitureSeq: 2 },
    };
    core = ok(take(core, inhouse.id)).core;
    core = ok(placeDevice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeDevice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(setInterface(core, 'u0', 0, '192.168.1.10', 24, env)).core;
    core = ok(setInterface(core, 'u1', 0, '192.168.1.11', 24, env)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env)).core;
    core = ok(requestBuild(passTest(core), env)).core;
    let r = ok(advanceBuild(core, env, balance.build.workStartHour));
    for (let i = 0; i < 20 && r.core.active.length > 0; i++) r = ok(advanceBuild(r.core, env, balance.build.workStartHour));
    expect(r.report?.passed).toBe(true);
    expect(r.report?.rewardDevices).toEqual([{ device: 'l2_switch_8p', count: 1 }]);
    expect(r.core.owned.l2_switch_8p).toBe(1);
  });

  it('納品したネットワークが自社オフィスに残り、次の自社案件に引き継がれる', () => {
    let core: Core = {
      ...start(),
      offers: [inhouseOffer],
      owned: { pc_basic: 2 },
      office: { size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [desk(3, 4), desk(8, 4)], furnitureSeq: 2 },
    };
    core = ok(take(core, inhouse.id)).core;
    core = ok(placeDevice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeDevice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(setInterface(core, 'u0', 0, '192.168.1.10', 24, env)).core;
    core = ok(setInterface(core, 'u1', 0, '192.168.1.11', 24, env)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env)).core;
    core = ok(requestBuild(passTest(core), env)).core;
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

describe('固定案件の取り消し（N41）', () => {
  it('固定案件をやめたら、その依頼は一覧に戻る', () => {
    const taken = ok(accept({ ...start(), offers: [offer] }, offer.id, 2, ['s0'])).core;
    expect(taken.offers.some((o) => o.baseId === offer.baseId)).toBe(false);
    const back = ok(abandon(taken)).core;
    expect(back.offers.filter((o) => o.baseId === offer.baseId)).toHaveLength(1);
    expect(back.active).toHaveLength(0);
  });
});

// 案件の manualIp を外す（自動割り当てを確かめるため。c001 は manualIp を持つ）
const autoIpOn = (core: Core): Core =>
  autoAssign(
    { ...core, active: core.active.map((p) => ({ ...p, contract: { ...p.contract, manualIp: false } })) },
    env,
    'focus',
    true,
  );

describe('IPアドレスとセグメントの設定', () => {
  // 2台を配線した c001 の設計中の状態
  const wired = (): Core => ok(connect(ok(take(start(), 'c001_direct_link')).core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;

  it('配線の後にIPアドレスを入力すると、そのネットワークがセグメントの設定になる', () => {
    let core = wired();
    expect(designIssues(cur(core)!, env)).toEqual({ pc_a: { reason: 'ip.unset' }, pc_b: { reason: 'ip.unset' } });
    core = ok(setInterface(core, 'pc_a', 0, '192.168.7.10', 24, env)).core;
    expect(cur(core)?.segments).toEqual({ 'pc_a:0': { network: '192.168.7.0', prefix: 24 } });
    expect(designIssues(cur(core)!, env)).toEqual({ pc_b: { reason: 'ip.unset' } });
  });

  it('セグメントの範囲外のアドレスは、設計の不備（ip.out_of_segment）になる', () => {
    let core = ok(setInterface(wired(), 'pc_a', 0, '192.168.7.10', 24, env)).core;
    core = ok(setInterface(core, 'pc_b', 0, '10.0.0.1', 24, env)).core;
    expect(designIssues(cur(core)!, env).pc_b).toEqual({ reason: 'ip.out_of_segment', ip: '10.0.0.1', segment: '192.168.7.0/24' });
  });

  it('setSegment はネットワークの設定だけを行い、機器のアドレスは振らない（振るのは autoAssign）', () => {
    const core = ok(setSegment(wired(), 'pc_a', 0, '192.168.5.0', 24, env)).core;
    expect(cur(core)?.segments).toEqual({ 'pc_a:0': { network: '192.168.5.0', prefix: 24 } });
    const ips = Object.fromEntries(cur(core)!.nodes.map((n) => [n.uid, n.interfaces[0]?.ip]));
    expect(ips).toEqual({ pc_a: undefined, pc_b: undefined });
    expect(designIssues(cur(core)!, env)).toMatchObject({ pc_a: { reason: 'ip.unset' } });
  });

  it('ネットワークを設定してから autoAssign を呼ぶと、ホストに空いているアドレスを .10 から順に割り当てる', () => {
    const core = autoIpOn(ok(setSegment(wired(), 'pc_a', 0, '192.168.5.0', 24, env)).core);
    const ips = Object.fromEntries(cur(core)!.nodes.map((n) => [n.uid, n.interfaces[0]?.ip]));
    expect(ips).toEqual({ pc_a: '192.168.5.10', pc_b: '192.168.5.11' });
    expect(designIssues(cur(core)!, env)).toEqual({});
  });

  it('setSegment は範囲外になった既存のアドレスを変えない（そのまま残り、設計の不備になる）', () => {
    let core = ok(setInterface(wired(), 'pc_a', 0, '192.168.5.11', 24, env)).core;
    core = ok(setSegment(core, 'pc_a', 0, '10.1.0.0', 24, env)).core;
    const ips = Object.fromEntries(cur(core)!.nodes.map((n) => [n.uid, n.interfaces[0]?.ip]));
    expect(ips).toEqual({ pc_a: '192.168.5.11', pc_b: undefined });
  });

  it('アドレスの候補は、使用中のアドレスに使っている機器を付けて一覧にする', () => {
    const core = autoIpOn(ok(setSegment(wired(), 'pc_a', 0, '192.168.5.0', 24, env)).core);
    const list = addressCandidates(core, 'pc_a', 0, env);
    expect(list).toHaveLength(254);
    expect(list[0]).toEqual({ ip: '192.168.5.1', usedBy: null });
    expect(list[list.length - 1].ip).toBe('192.168.5.254');
    expect(list.find((c) => c.ip === '192.168.5.10')?.usedBy).toEqual({ node: 'pc_a', port: 0 });
  });

  it('設定のないセグメントの候補は空の一覧になる', () => {
    expect(addressCandidates(wired(), 'pc_a', 0, env)).toEqual([]);
  });

  it('ネットワークの形式が正しくない、またはプレフィックス長が候補の外なら設定できない', () => {
    expect(setSegment(wired(), 'pc_a', 0, '192.168.5.1', 24, env)).toEqual({ ok: false, reason: 'ip' });
    expect(setSegment(wired(), 'pc_a', 0, '192.168.5.0', 16, env)).toEqual({ ok: false, reason: 'ip' });
  });

  it('案件で設定が固定された機器を含むセグメントは、ネットワークを変えられない', () => {
    const core = wired();
    const locked = { ...core, active: core.active.map((p) => ({ ...p, nodes: p.nodes.map((n) => ({ ...n, configLocked: true })) })) };
    expect(setSegment(locked, 'pc_a', 0, '192.168.5.0', 24, env)).toEqual({ ok: false, reason: 'locked' });
  });

  it('ホスト数に対してアドレスが足りないネットワークは設定できない（segment.too_small）', () => {
    const pcNode = (uid: string, x: number) => ({
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
    });
    const cable = (uid: string, a: string, port: number) => ({
      uid,
      cable: 'utp_cat5e',
      a: { node: a, port },
      b: { node: 's', port: 0 },
      path: [
        [0, 0],
        [1, 0],
      ] as [number, number][],
      paid: 0,
    });
    // 3台のPCをスイッチでつないだ自社オフィス。/30 には3台分のアドレスがない
    const office = {
      size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [],
      nodes: [pcNode('a', 1), pcNode('b', 2), pcNode('c', 3), { ...pcNode('s', 4), device: 'l2_switch_8p' }],
      links: [cable('l0', 'a', 0), { ...cable('l1', 'b', 0), b: { node: 's', port: 1 } }, { ...cable('l2', 'c', 0), b: { node: 's', port: 2 } }],
      seq: 4,
      furniture: [],
      furnitureSeq: 0,
    };
    const core: Core = { ...start(), office };
    expect(setSegment(core, 'a', 0, '192.168.9.0', 30, env, 'office')).toEqual({ ok: false, reason: 'segment.too_small' });
    expect(setSegment(core, 'a', 0, '192.168.9.0', 24, env, 'office').ok).toBe(true);
  });
});

describe('テストと施工の依頼', () => {
  // IPアドレスを設定し、配線した c001 の設計（テストに合格する）
  const designed = (): Core => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(setInterface(core, 'pc_a', 0, '192.168.1.10', 24, env)).core;
    core = ok(setInterface(core, 'pc_b', 0, '192.168.1.11', 24, env)).core;
    return ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
  };

  it('テストに合格すると testedOk が true になり、パケットの経路を返す。時間も費用もかからない', () => {
    const before = designed();
    const r = testDesign(before, env);
    if (!r.ok) throw new Error(r.reason);
    expect(r.result.passed).toBe(true);
    expect(r.result.goals.every((g) => g.ok)).toBe(true);
    expect(r.result.traces.length).toBeGreaterThan(0);
    expect(cur(r.core)?.testedOk).toBe(true);
    expect(r.core.clock).toEqual(before.clock);
    expect(r.core.clock.minute).toBe(before.clock.minute);
  });

  it('テストは何度でも押せる', () => {
    const again = testDesign(passTest(designed()), env);
    if (!again.ok) throw new Error(again.reason);
    expect(again.result.passed).toBe(true);
  });

  it('テストは設計中だけ押せる', () => {
    const building = ok(requestBuild(passTest(designed()), env)).core;
    expect(testDesign(building, env)).toEqual({ ok: false, reason: 'phase' });
  });

  it('テストに合格していれば、施工を依頼できる', () => {
    const r = ok(requestBuild(passTest(designed()), env)).core;
    expect(cur(r)?.phase).toBe('build');
  });

  it('テストに合格していなければ、施工を依頼できない（untested）', () => {
    expect(requestBuild(designed(), env)).toEqual({ ok: false, reason: 'untested' });
  });

  it.each([
    ['IPアドレスを変える', (c: Core) => setInterface(c, 'pc_a', 0, '192.168.1.20', 24, env)],
    ['ゲートウェイを変える', (c: Core) => setGateway(c, 'pc_a', '192.168.1.1')],
    ['サービスを変える', (c: Core) => setService(c, 'pc_a', 'http', true)],
    ['配線を撤去する', (c: Core) => removeLink(c, cur(c)!.links[0].uid, 'focus', env)],
    ['機器を置く', (c: Core) => placeDevice({ ...c, owned: { pc_basic: 1 } }, 'pc_basic', 6, 6, map, env)],
  ])('設計を変えると（%s）testedOk が false に戻り、施工を依頼できない', (_name, change) => {
    const after = change(passTest(designed()));
    if (!after.ok) throw new Error(after.reason);
    expect(cur(after.core)?.testedOk).toBe(false);
    expect(requestBuild(after.core, env)).toEqual({ ok: false, reason: 'untested' });
  });

  it('不合格の結果が残っていても、設計を変えたあとに再テストで合格すれば施工できる', () => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    const failed = testDesign(core, env);
    if (!failed.ok) throw new Error(failed.reason);
    expect(failed.result.passed).toBe(false);
    const fixed = ok(setInterface(failed.core, 'pc_a', 0, '192.168.1.10', 24, env)).core;
    const fixed2 = ok(setInterface(fixed, 'pc_b', 0, '192.168.1.11', 24, env)).core;
    expect(cur(fixed2)?.testedOk).toBe(false);
    expect(ok(requestBuild(passTest(fixed2), env)).core.active[0].phase).toBe('build');
  });
});

describe('配線の前のIPアドレス（PC・サーバー）', () => {
  // 2台のPCを置いた c001 の設計中の状態（配線はしていない）
  const unwired = (): Core => ok(take(start(), 'c001_direct_link')).core;

  it('配線していないPCにIPアドレスを設定でき、セグメントはまだ作られない', () => {
    const core = ok(setInterface(unwired(), 'pc_a', 0, '192.168.1.10', 24, env)).core;
    expect(cur(core)?.nodes.find((n) => n.uid === 'pc_a')?.interfaces).toEqual([{ port: 0, ip: '192.168.1.10', prefix: 24 }]);
    expect(cur(core)?.segments ?? {}).toEqual({});
  });

  it('配線すると、入力したアドレスの /24 がセグメントの設定になる', () => {
    let core = ok(setInterface(unwired(), 'pc_a', 0, '192.168.1.10', 24, env)).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    expect(cur(core)?.segments).toEqual({ 'pc_a:0': { network: '192.168.1.0', prefix: 24 } });
    expect(designIssues(cur(core)!, env)).toEqual({ pc_b: { reason: 'ip.unset' } });
  });

  it('別々に設定した2台を配線すると、疎通テストに合格する', () => {
    let core = ok(setInterface(unwired(), 'pc_a', 0, '192.168.1.10', 24, env)).core;
    core = ok(setInterface(core, 'pc_b', 0, '192.168.1.11', 24, env)).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    expect(cur(core)?.segments).toEqual({ 'pc_a:0': { network: '192.168.1.0', prefix: 24 } });
    expect(designIssues(cur(core)!, env)).toEqual({});
    const r = testDesign(core, env);
    if (!r.ok) throw new Error(r.reason);
    expect(r.result.passed).toBe(true);
  });

  it('配線の前の候補は 192.168.1.1 から並び、ほかの機器が使っているアドレスには使っている機器を付ける', () => {
    const core = ok(setInterface(unwired(), 'pc_a', 0, '192.168.1.10', 24, env)).core;
    const list = plannedAddressCandidates(core, '192.168.1.0', 24);
    expect(list[0]).toEqual({ ip: '192.168.1.1', usedBy: null });
    expect(list[9]).toEqual({ ip: '192.168.1.10', usedBy: { node: 'pc_a', port: 0 } });
    expect(list[list.length - 1].ip).toBe('192.168.1.254');
    expect(list).toHaveLength(254);
  });

  it('設定の前と後で候補の範囲と順は同じ（.1 からブロードキャストの1つ前まで）', () => {
    const linked = ok(connect(unwired(), 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    const before = plannedAddressCandidates(linked, '192.168.5.0', 24);
    const after = addressCandidates(ok(setSegment(linked, 'pc_a', 0, '192.168.5.0', 24, env)).core, 'pc_a', 0, env);
    expect(after.map((c) => c.ip)).toEqual(before.map((c) => c.ip));
    expect(before[0].ip).toBe('192.168.5.1');
    expect(before[before.length - 1].ip).toBe('192.168.5.254');
  });

  it('配線の前に設定したアドレスは、入力した値のまま残る', () => {
    const core = ok(setInterface(unwired(), 'pc_a', 0, '10.20.30.40', 24, env)).core;
    expect(cur(core)?.nodes.find((n) => n.uid === 'pc_a')?.interfaces[0]).toEqual({ port: 0, ip: '10.20.30.40', prefix: 24 });
  });
});

describe('施工の進み（advanceBuild）', () => {
  // c001 の2台を配線し、テストに合格させて施工を依頼した状態（担当は2人）
  const building = (): Core => {
    let core = ok(take(start(), 'c001_direct_link')).core;
    core = ok(setInterface(core, 'pc_a', 0, '192.168.1.10', 24, env)).core;
    core = ok(setInterface(core, 'pc_b', 0, '192.168.1.11', 24, env)).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    return ok(requestBuild(passTest(core), env)).core;
  };
  const withTotal = (core: Core, total: number): Core => ({
    ...core,
    active: core.active.map((p) => ({ ...p, total, progress: 0 })),
  });
  const progressOf = (core: Core, id: string) => core.active.find((p) => p.id === id)?.progress ?? 0;

  it('夜勤の担当は夜に施工を進め、昼は進めない（N48）', () => {
    const base = withTotal(building(), 1e9);
    const night = { ...base, staff: base.staff.map((s) => ({ ...s, shift: 'night' as const })) };
    const atNoon = ok(advanceBuild(night, env, 12)).core;
    const atNight = ok(advanceBuild(night, env, 23)).core;
    expect(progressOf(atNoon, cur(base)!.id)).toBe(0);
    expect(progressOf(atNight, cur(base)!.id)).toBeGreaterThan(0);
  });

  it('案件の向いている職種（jobs）の社員は、施工力が職種の一致の倍率（1.5倍）になる。前提の案件（requires）は関係ない', () => {
    const base = withTotal(building(), 1e9);
    const id = cur(base)!.id;
    // 2人とも同じ職種にして、案件の求める職種だけを変える
    const staff = base.staff.map((s) => ({ ...s, job: 'network' as const }));
    const withJobs = (core: Core, jobs: JobId[]): Core => ({
      ...core,
      staff,
      active: core.active.map((p) => ({ ...p, contract: { ...p.contract, jobs } })),
    });
    const plain = ok(advanceBuild(withJobs(base, []), env, balance.build.workStartHour)).core;
    const matched = ok(advanceBuild(withJobs(base, ['network']), env, balance.build.workStartHour)).core;
    expect(progressOf(plain, id)).toBeGreaterThan(0);
    expect(progressOf(matched, id) / progressOf(plain, id)).toBeCloseTo(balance.staff.power.jobMatch);
  });

  it('1つの案件が検収されても、同じTickのほかの案件の進みを捨てない', () => {
    const core = withTotal(building(), 1);
    const first = cur(core)!;
    const second = { ...first, id: 'other' };
    const both: Core = { ...core, active: [first, second] };
    const r = ok(advanceBuild(both, env, balance.build.workStartHour));
    // 先の案件は検収されて納品される
    expect(r.report?.passed).toBe(true);
    expect(r.core.active.map((p) => p.id)).toEqual(['other']);
    // あとの案件も、この Tick の進みを反映している（検収はまだ次の Tick）
    expect(progressOf(r.core, 'other')).toBeGreaterThanOrEqual(1);
    expect(r.core.active[0]?.built.nodes.length).toBeGreaterThan(0);
  });
});

describe('机の上に置ける機器（N91）', () => {
  // 床の上に机が1つあるオフィス
  const deskAt = (x: number, y: number) => ({ uid: `d${x}${y}`, id: 'desk', x, y });
  const officeWith = (furniture: { uid: string; id: string; x: number; y: number }[], nodes: NetNode[] = []) => ({
    ...start().office, furniture, furnitureSeq: furniture.length, nodes,
  });
  const info = (category: string, deskable: boolean) => ({ category, price: 1, portCount: 1, deskable });
  const env = {
    devices: { pc_basic: info('pc', false), printer_basic: info('printer', true), server_basic: info('server', false) },
    furniture: { desk: { seat: true } },
  } as unknown as Env;
  // 床だけの地図（5×5）
  const map = { id: 'hq', width: 5, height: 5, legend: { '.': 'floor' }, tiles: ['.....', '.....', '.....', '.....', '.....'] } as unknown as GameMap;
  // 在庫を持たせて、機器を1台置く。置けなければ理由を返す
  const placeAt = (office: ReturnType<typeof officeWith>, device: string, x: number, y: number): string | null => {
    const core = { ...start(), office, owned: { [device]: 1 } } as Core;
    const out = placeInOffice(core, device, x, y, map, env);
    return out.ok ? null : out.reason;
  };

  it('deskable の機器は、机の上にも床にも置ける', () => {
    expect(placeAt(officeWith([deskAt(1, 1)]), 'printer_basic', 1, 1)).toBeNull();
    expect(placeAt(officeWith([deskAt(1, 1)]), 'printer_basic', 3, 3)).toBeNull();
  });

  it('机の上の機器は、机1台に1台（ほかに機器があれば tile）', () => {
    const office = officeWith([deskAt(1, 1)], [{ uid: 'u0', device: 'pc_basic', x: 1, y: 1 } as NetNode]);
    expect(placeAt(office, 'printer_basic', 1, 1)).toBe('tile');
  });

  it('PC（deskable でない）は床に置けない（desk）', () => {
    expect(placeAt(officeWith([]), 'pc_basic', 3, 3)).toBe('desk');
  });

  it('サーバー（deskable でない）は、机の上にも床にも置けない（tile）', () => {
    expect(placeAt(officeWith([deskAt(1, 1)]), 'server_basic', 1, 1)).toBe('tile');
    expect(placeAt(officeWith([]), 'server_basic', 3, 3)).toBeNull();
  });
});

describe('任せて受注したときの画面の対象（N111）', () => {
  it('任せて受注しても、画面の対象（focus）は受注の前のまま', () => {
    const before = { focus: 'hq-office' } as unknown as Core;
    const accepted = { ok: true, core: { focus: 'c001' } } as unknown as Outcome;
    const kept = keepFocus(before, accepted);
    expect(kept.ok && kept.core.focus).toBe('hq-office');
  });

  it('失敗したときは、そのまま失敗を返す', () => {
    const before = { focus: null } as unknown as Core;
    expect(keepFocus(before, { ok: false, reason: 'crew' })).toEqual({ ok: false, reason: 'crew' });
  });
});
