// 定型案件の想定の解答。新しい種類ごとに、想定の解き方で合格し、スイッチでつなぐだけでは合格しないことを確かめる。
// 費用は、案件に置いた機器の定価と配線の費用（projectCostOf）。想定の解き方で★3 が取れる（費用が予算以内）ことも確かめる。
import { describe, expect, it } from 'vitest';
import { contractTemplates } from 'virtual:game-data';
import balanceJson from '../../resources/data/balance.json';
import furnitureJson from '../../resources/data/furniture.json';
import clinicMap from '../../resources/data/maps/clinic.json';
import type { Balance, ContractTemplate, Furniture, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import { instantiateTemplate, starHubOf } from '../contracts/template';
import { EMPTY_FAMILIARITY } from './familiar';
import { initialOffice } from './furniture';
import { initialStaff } from './staff';
import { connect, focusedOf, type Core, type Env, type Report } from './project';
import { accept, advanceBuild, requestBuild, testDesign } from './progress';
import { placeDevice } from './placement';
import { setInterface } from './netEdit';
import { deviceDef } from '../registry/query';
import { buyDevice } from './shop';

const balance = balanceJson as unknown as Balance;
const env: Env = {
  balance,
  furniture: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
  engine: { wallAt: () => false, interferers: [] },
};
const UTP = 'utp_cat5e';
const SWITCH = 'l2_switch_8p';
const ROUTER = 'router_basic';

const templateOf = (id: string): ContractTemplate => {
  const t = contractTemplates.find((x) => x.id === id);
  if (!t) throw new Error(`ひな形 ${id} がない`);
  return t;
};

const startCore = (offer: Offer): Core => ({
  clock: { minute: 0, money: balance.startMoney * 100, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  firstGoals: [],
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
  offers: [offer],
  active: [],
  focus: null,
  office: initialOffice(balance),
  effects: { buildSpeed: 0 },
  staff: initialStaff(balance, 1).staff,
  staffSeq: 2,
  candidates: [],
  guidesDone: [],
  guidesHidden: [],
  termsShown: [],
});

const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`操作に失敗: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

const take = (core: Core, offerId: string): Core => ok(accept(core, offerId, balance.office.projectSlots, core.staff.map((s) => s.uid))).core;

const buy = (core: Core, deviceId: string): Core => {
  const r = buyDevice(core.clock.money, core.owned, deviceId, deviceDef(deviceId).price);
  if (!r.ok) throw new Error(`買えない: ${deviceId}`);
  return { ...core, clock: { ...core.clock, money: r.money }, owned: r.owned };
};

// 機器を買って、指定のマスの近く（置ける最も近いマス）に置き、置いた機器の uid を返す
const place = (core: Core, deviceId: string, x: number, y: number, map: GameMap): { core: Core; uid: string } => {
  const bought = buy(core, deviceId);
  const cells: { x: number; y: number; d: number }[] = [];
  for (let cy = 0; cy < map.height; cy++) for (let cx = 0; cx < map.width; cx++) cells.push({ x: cx, y: cy, d: Math.abs(cx - x) + Math.abs(cy - y) });
  cells.sort((a, b) => a.d - b.d);
  for (const c of cells) {
    const r = placeDevice(bought, deviceId, c.x, c.y, map, env);
    if (!r.ok) continue;
    const nodes = focusedOf(r.core)!.nodes;
    return { core: r.core, uid: nodes[nodes.length - 1].uid };
  }
  throw new Error(`置ける場所がない: ${deviceId}`);
};

const wire = (core: Core, a: string, b: string, cable = UTP, ports: { a?: number; b?: number } = {}): Core =>
  ok(connect(core, a, b, cable, env, 'focus', ports)).core;

const addr = (core: Core, uid: string, ip: string, port = 0): Core => ok(setInterface(core, uid, port, ip, 24, env)).core;

// テストに合格するか
const passes = (core: Core): boolean => ok(testDesign(core, env)).result.passed;

// 検収まで進める。★3 で合格し、費用が予算以内であること
const finish = (core: Core): Report => {
  const tested = ok(testDesign(core, env));
  if (!tested.result.passed) throw new Error(`テストに不合格: ${JSON.stringify(tested.result.goals.filter((g) => !g.ok))}`);
  let state = ok(requestBuild(tested.core, env)).core;
  for (let i = 0; i < 5000; i++) {
    const hour = Math.floor((state.clock.minute % (24 * 60)) / 60);
    const r = ok(advanceBuild(state, env, hour));
    if (r.report) return r.report;
    state = { ...r.core, clock: { ...r.core.clock, minute: r.core.clock.minute + balance.time.gameMinutesPerTick } };
  }
  throw new Error('施工が終わらない');
};

const SEEDS = [1, 2, 3, 4, 5, 6];
const offerOf = (id: string, map: GameMap, seed: number): Offer => instantiateTemplate(templateOf(id), map, 0, seed).offer;
const centerOf = (points: { x: number; y: number }[], map: GameMap) => starHubOf(points, map);

describe('t_clinic: 受付と診察室は別のネットワーク', () => {
  const map = clinicMap as unknown as GameMap;
  // 受付（group 1）と診察室（group 2・3）のスイッチを、それぞれの PC の中心に置き、ルーターの2つの口につなぐ
  const solve = (offer: Offer, withRouter: boolean): Core => {
    let core = take(startCore(offer), offer.id);
    const pcs = offer.contract.placed;
    const inNet = (n: number) => pcs.filter((p) => p.config?.interfaces[0].ip.startsWith(`192.168.${n}.`));
    const swA = place(core, SWITCH, centerOf(inNet(1), map).x, centerOf(inNet(1), map).y, map);
    core = swA.core;
    const swB = place(core, SWITCH, centerOf(inNet(2), map).x, centerOf(inNet(2), map).y, map);
    core = swB.core;
    for (const p of inNet(1)) core = wire(core, p.ref, swA.uid);
    for (const p of inNet(2)) core = wire(core, p.ref, swB.uid);
    if (withRouter) {
      const router = place(core, ROUTER, 10, 4, map);
      core = router.core;
      core = wire(core, swA.uid, router.uid, UTP, { b: 0 });
      core = wire(core, swB.uid, router.uid, UTP, { b: 1 });
      core = addr(core, router.uid, '192.168.1.1');
      core = addr(core, router.uid, '192.168.2.1', 1);
    } else {
      core = wire(core, swA.uid, swB.uid);
    }
    return core;
  };
  for (const seed of SEEDS) {
    it(`種 ${seed}: ルーターで2つのネットワークをつなぐと合格し、★3 になる`, () => {
      const offer = offerOf('t_clinic', map, seed);
      const report = finish(solve(offer, true));
      expect(report.passed).toBe(true);
      expect(report.stars).toBe(3);
    });
    it(`種 ${seed}: スイッチだけでつなぐと不合格`, () => {
      expect(passes(solve(offerOf('t_clinic', map, seed), false))).toBe(false);
    });
  }
});
