// IPアドレスの自動割り当ての確認。配線の後に autoAssign を呼ぶ（ストアと同じ順）。固定案件 c001・c002 を使う
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import cablesJson from '../assets/data/cables.json';
import furnitureJson from '../assets/data/furniture.json';
import pcJson from '../assets/data/devices/pc.json';
import routerJson from '../assets/data/devices/router.json';
import switchJson from '../assets/data/devices/l2_switch.json';
import serverJson from '../assets/data/devices/server.json';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import c002 from '../assets/data/contracts/c002_small_office.json';
import officeSmall from '../assets/data/maps/office_small.json';
import type { Balance, Contract, Furniture, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import { initialStaff } from './staff';
import { initialOffice } from './furniture';
import { entryOf, stepDesign } from './history';
import { autoAssign } from './autoAssign';
import { accept, connect, focusedOf, placeDevice, placeInOffice, setGateway, setInterface, setSegment, type Core, type Env } from './project';
import { buyDevice } from './shop';

const balance = balanceJson as unknown as Balance;
const map = officeSmall as unknown as GameMap;

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

const UTP = 'utp_cat5e';
const SWITCH = 'l2_switch_8p';
const ROUTER = 'router_basic';

const fixedOffer = (contract: unknown): Offer => {
  const c = contract as Contract;
  return { id: c.id, kind: 'fixed', baseId: c.id, params: {}, contract: c };
};

const startCore = (offers: Offer[]): Core => ({
  clock: { minute: 0, money: balance.startMoney, paidMonths: 0, bankrupt: false },
  companyExp: 0,
  owned: {},
  completed: [],
  offers,
  active: [],
  focus: null,
  office: initialOffice(balance),
  effects: { buildSpeed: 0 },
  staff: initialStaff(balance, 1).staff,
  staffSeq: 2,
  candidates: [],
  guidesDone: [],
});

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`操作に失敗: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

// 案件を受注する（担当は社員全員）
const take = (core: Core, offerId: string): Core => {
  const crew = core.staff.map((s) => s.uid);
  return ok(accept(core, offerId, balance.office.projectSlots, crew)).core;
};

// 機材を買い、案件の費用に加える（店の購入と同じ）
const buy = (core: Core, deviceId: string): Core => {
  const price = devices[deviceId].price;
  const r = buyDevice(core.clock.money, core.owned, deviceId, price);
  if (!r.ok) throw new Error(`買えない: ${deviceId}`);
  const p = focusedOf(core);
  return {
    ...core,
    clock: { ...core.clock, money: r.money },
    owned: r.owned,
    active: p ? core.active.map((q) => (q.id === p.id ? { ...q, cost: q.cost + price } : q)) : core.active,
  };
};

// 機材を置き、置いた機器の uid を返す
const place = (core: Core, deviceId: string, x: number, y: number): { core: Core; uid: string } => {
  const next = ok(placeDevice(core, deviceId, x, y, map, env)).core;
  const nodes = focusedOf(next)!.nodes;
  return { core: next, uid: nodes[nodes.length - 1].uid };
};

// 配線し、ストアと同じく自動割り当てをかける
const wireAuto = (core: Core, a: string, b: string, on = true): Core => {
  const wired = ok(connect(core, a, b, UTP, env, 'focus')).core;
  return autoAssign(wired, env, 'focus', on);
};

const addr = (core: Core, uid: string, ip: string): Core => ok(setInterface(core, uid, 0, ip, 24, env)).core;

// 機器のポート0のアドレス（uid → ip）
const ipsOf = (core: Core): Record<string, string | undefined> =>
  Object.fromEntries(focusedOf(core)!.nodes.map((n) => [n.uid, n.interfaces.find((i) => i.port === 0)?.ip]));

const nodeOf = (core: Core, uid: string) => focusedOf(core)!.nodes.find((n) => n.uid === uid)!;

// 固定案件 c002（PC3台、スイッチで集める）を受注し、スイッチを (10,4) に置く
const officeWithSwitch = (): { core: Core; sw: string } => {
  let core = take(startCore([fixedOffer(c002)]), 'c002_small_office');
  core = buy(core, SWITCH);
  const sw = place(core, SWITCH, 10, 4);
  return { core: sw.core, sw: sw.uid };
};

describe('IPアドレスの自動割り当て（autoAssign）', () => {
  it('振られる順: セグメントの決まったあとにつないだ PC から、.10 から順に空いているアドレスを振り、使用中は飛ばす', () => {
    const { core: base, sw } = officeWithSwitch();
    // 1台目を手で .11 にすると、セグメントが 192.168.1.0/24 に決まる
    let core = ok(connect(base, 'pc_a', sw, UTP, env, 'focus')).core;
    core = addr(core, 'pc_a', '192.168.1.11');
    core = wireAuto(core, 'pc_b', sw);
    core = wireAuto(core, 'pc_c', sw);
    expect(ipsOf(core)).toMatchObject({ pc_a: '192.168.1.11', pc_b: '192.168.1.10', pc_c: '192.168.1.12' });
  });

  it('ネットワークが決まっていないセグメントには、ほかと重ならない 192.168.N.0/24 を既定として決め、つないだ PC に .10 から振る', () => {
    let core = take(startCore([fixedOffer(c002)]), 'c002_small_office');
    core = ok(connect(core, 'pc_a', 'pc_b', UTP, env, 'focus')).core;
    core = autoAssign(core, env, 'focus', true);
    expect(ipsOf(core)).toMatchObject({ pc_a: '192.168.1.10', pc_b: '192.168.1.11', pc_c: undefined });
    expect(focusedOf(core)!.segments).toEqual({ 'pc_a:0': { network: '192.168.1.0', prefix: 24 } });
  });

  it('振る相手がいないセグメント（ルーターだけ）には、ネットワークを決めない', () => {
    const { core: base, sw } = officeWithSwitch();
    const router = place(buy(base, ROUTER), ROUTER, 6, 6);
    const core = wireAuto(router.core, router.uid, sw);
    expect(focusedOf(core)!.segments).toEqual({});
    expect(nodeOf(core, router.uid).interfaces).toEqual([]);
  });

  it('既定のネットワークは、ほかのセグメントと重ならない N を選ぶ（2つ目のセグメントは 192.168.2.0/24）', () => {
    let core = take(startCore([fixedOffer(c002)]), 'c002_small_office');
    core = ok(connect(core, 'pc_a', 'pc_b', UTP, env, 'focus')).core;
    core = autoAssign(core, env, 'focus', true);
    core = buy(core, SWITCH);
    const sw = place(core, SWITCH, 10, 4);
    core = ok(connect(sw.core, 'pc_c', sw.uid, UTP, env, 'focus')).core;
    core = autoAssign(core, env, 'focus', true);
    expect(nodeOf(core, 'pc_c')).toMatchObject({ interfaces: [{ port: 0, ip: '192.168.2.10', prefix: 24 }] });
    expect(nodeOf(core, 'pc_a').interfaces[0].ip).toBe('192.168.1.10');
  });

  it('既定のネットワークでは、ルーターのポートに .1 を振り、ホストのゲートウェイも .1 にする', () => {
    const { core: base, sw } = officeWithSwitch();
    let core = ok(connect(base, 'pc_a', sw, UTP, env, 'focus')).core;
    const router = place(buy(core, ROUTER), ROUTER, 6, 6);
    core = wireAuto(router.core, router.uid, sw);
    expect(nodeOf(core, router.uid).interfaces).toEqual([{ port: 0, ip: '192.168.1.1', prefix: 24 }]);
    expect(nodeOf(core, 'pc_a')).toMatchObject({ gateway: '192.168.1.1', interfaces: [{ port: 0, ip: '192.168.1.10', prefix: 24 }] });
  });

  it('ゲートウェイ: 未設定で、同じセグメントにルーターのアドレスがあれば、それを使う。ルーターのポートは振らない', () => {
    const { core: base, sw } = officeWithSwitch();
    let core = ok(connect(base, 'pc_a', sw, UTP, env, 'focus')).core;
    core = addr(core, 'pc_a', '192.168.1.11');
    const router = place(buy(core, ROUTER), ROUTER, 6, 6);
    core = wireAuto(router.core, router.uid, sw);
    expect(nodeOf(core, router.uid).interfaces).toEqual([]);
    core = addr(core, router.uid, '192.168.1.1');
    core = wireAuto(core, 'pc_b', sw);
    expect(nodeOf(core, 'pc_b')).toMatchObject({ gateway: '192.168.1.1', interfaces: [{ port: 0, ip: '192.168.1.10', prefix: 24 }] });
  });

  it('既にゲートウェイがあるPCは、ゲートウェイを変えない', () => {
    const { core: base, sw } = officeWithSwitch();
    let core = ok(connect(base, 'pc_a', sw, UTP, env, 'focus')).core;
    core = addr(core, 'pc_a', '192.168.1.11');
    core = ok(setGateway(core, 'pc_b', '192.168.1.99', 'focus')).core;
    core = wireAuto(core, 'pc_b', sw);
    expect(nodeOf(core, 'pc_b')).toMatchObject({ gateway: '192.168.1.99', interfaces: [{ port: 0, ip: '192.168.1.10', prefix: 24 }] });
  });

  it('既にIPアドレスのあるポートは変えない', () => {
    const { core: base, sw } = officeWithSwitch();
    let core = ok(connect(base, 'pc_a', sw, UTP, env, 'focus')).core;
    core = addr(core, 'pc_a', '192.168.1.11');
    core = addr(core, 'pc_b', '192.168.1.50');
    core = wireAuto(core, 'pc_c', sw);
    expect(ipsOf(core)).toMatchObject({ pc_a: '192.168.1.11', pc_b: '192.168.1.50', pc_c: '192.168.1.10' });
  });

  it('manualIp の案件（c001）では、設定がオンでも振らない', () => {
    let core = take(startCore([fixedOffer(c001)]), 'c001_direct_link');
    core = addr(core, 'pc_a', '192.168.1.11');
    core = ok(connect(core, 'pc_a', 'pc_b', UTP, env, 'focus')).core;
    expect(autoAssign(core, env, 'focus', true)).toBe(core);
    expect(ipsOf(core)).toEqual({ pc_a: '192.168.1.11', pc_b: undefined });
  });

  it('設定がオフのときは振らない', () => {
    const { core: base, sw } = officeWithSwitch();
    let core = ok(connect(base, 'pc_a', sw, UTP, env, 'focus')).core;
    core = addr(core, 'pc_a', '192.168.1.11');
    core = ok(connect(core, 'pc_b', sw, UTP, env, 'focus')).core;
    expect(autoAssign(core, env, 'focus', false)).toBe(core);
    expect(ipsOf(core)).toMatchObject({ pc_b: undefined });
  });

  it('取り消しは配線と一緒に戻る（操作の前後の状態から作った項目を戻すと、配線も割り当ても消える）', () => {
    const { core: base, sw } = officeWithSwitch();
    let before = ok(connect(base, 'pc_a', sw, UTP, env, 'focus')).core;
    before = addr(before, 'pc_a', '192.168.1.11');
    const after = wireAuto(before, 'pc_b', sw);
    expect(nodeOf(after, 'pc_b').interfaces).toHaveLength(1);
    const undone = stepDesign(after, entryOf(before, after), 'undo');
    expect(undone.ok).toBe(true);
    if (!undone.ok) return;
    expect(focusedOf(undone.core)!.links).toEqual(focusedOf(before)!.links);
    expect(focusedOf(undone.core)!.nodes).toEqual(focusedOf(before)!.nodes);
    expect(nodeOf(undone.core, 'pc_b').interfaces).toEqual([]);
  });
});


// 自社オフィス（案件なし・サンドボックス）の対象。案件の focus を使わず、target 'office' で振る
describe('IPアドレスの自動割り当て（自社オフィス・サンドボックスの対象）', () => {
  const PC_DEVICE = 'pc_basic';
  const emptyOffice = (core: Core): Core => ({ ...core, active: [], focus: null, owned: { [SWITCH]: 1, [PC_DEVICE]: 2 } });
  // 自社オフィスの床に機器を置き、置いた機器の uid を返す
  const putOffice = (core: Core, dev: string, x: number, y: number): { core: Core; uid: string } => {
    const next = ok(placeInOffice(core, dev, x, y, map, env, true)).core;
    return { core: next, uid: next.office.nodes[next.office.nodes.length - 1].uid };
  };
  // PC 2台をスイッチへつないだ床を作る（ネットワークはまだ決めていない）
  const sandboxWired = (): { core: Core; a: string; b: string } => {
    let core = emptyOffice(startCore([]));
    const sw = putOffice(core, SWITCH, 4, 6);
    const a = putOffice(sw.core, PC_DEVICE, 3, 3);
    const b = putOffice(a.core, PC_DEVICE, 5, 3);
    core = ok(connect(b.core, a.uid, sw.uid, UTP, env, 'office')).core;
    core = ok(connect(core, b.uid, sw.uid, UTP, env, 'office')).core;
    return { core, a: a.uid, b: b.uid };
  };
  const officeNode = (core: Core, uid: string) => core.office.nodes.find((n) => n.uid === uid)!;

  it('サンドボックス: ネットワークを設定すると、つないだ PC に .10 から順に振る（ゲートウェイは未設定のまま）', () => {
    const { core: base, a, b } = sandboxWired();
    const set = ok(setSegment(base, a, 0, '192.168.7.0', 24, env, 'office')).core;
    const core = autoAssign(set, env, 'office', true);
    expect(officeNode(core, a).interfaces).toEqual([{ port: 0, ip: '192.168.7.10', prefix: 24 }]);
    expect(officeNode(core, b).interfaces).toEqual([{ port: 0, ip: '192.168.7.11', prefix: 24 }]);
    expect(officeNode(core, a).gateway).toBeNull();
  });

  it('自社オフィス（案件なし）: 設定がオンなら、ネットワークの決まったセグメントの PC に振る', () => {
    const { core: base, a, b } = sandboxWired();
    const set = ok(setSegment(base, b, 0, '10.0.0.0', 24, env, 'office')).core;
    const on = autoAssign(set, env, 'office', true);
    expect(officeNode(on, a).interfaces).toEqual([{ port: 0, ip: '10.0.0.10', prefix: 24 }]);
    expect(officeNode(on, b).interfaces).toEqual([{ port: 0, ip: '10.0.0.11', prefix: 24 }]);
  });

  it('設定がオフなら、サンドボックスでも振らない', () => {
    const { core: base, a } = sandboxWired();
    const set = ok(setSegment(base, a, 0, '192.168.7.0', 24, env, 'office')).core;
    expect(autoAssign(set, env, 'office', false)).toBe(set);
    expect(officeNode(set, a).interfaces).toEqual([]);
  });
});

describe('詳しくで選んだネットワーク（planned）', () => {
  it('ネットワークが決まっていないセグメントは、選んだネットワークで振る', () => {
    const { core: base, sw } = officeWithSwitch();
    const wired = ok(connect(base, 'pc_a', sw, UTP, env, 'focus')).core;
    const planned = () => ({ network: '192.168.7.0', prefix: 24 });
    const out = autoAssign(wired, env, 'focus', true, planned);
    expect(ipsOf(out).pc_a).toBe('192.168.7.10');
  });

  it('選んだネットワークがなければ、従来どおり既定の 192.168.N.0/24 を使う', () => {
    const { core: base, sw } = officeWithSwitch();
    const wired = ok(connect(base, 'pc_a', sw, UTP, env, 'focus')).core;
    expect(ipsOf(autoAssign(wired, env, 'focus', true))).toEqual(ipsOf(autoAssign(wired, env, 'focus', true, () => undefined)));
  });
});
