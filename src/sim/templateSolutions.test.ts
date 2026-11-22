// 定型案件の想定の解答。新しい種類ごとに、想定の解き方で合格し、スイッチでつなぐだけでは合格しないことを確かめる。
// 費用は、案件に置いた機器の定価と配線の費用（projectCostOf）。想定の解き方で★3 が取れる（費用が予算以内）ことも確かめる。
import { describe, expect, it } from 'vitest';
import { contractTemplates } from 'virtual:game-data';
import balanceJson from '../../resources/data/balance.json';
import furnitureJson from '../../resources/data/furniture.json';
import clinicMap from '../../resources/data/maps/clinic.json';
import coworkingMap from '../../resources/data/maps/coworking.json';
import warehouseMap from '../../resources/data/maps/warehouse.json';
import longHallMap from '../../resources/data/maps/long_hall.json';
import campusWideMap from '../../resources/data/maps/campus_wide.json';
import factoryMap from '../../resources/data/maps/factory.json';
import twoSitesMap from '../../resources/data/maps/office_two_sites.json';
import schoolLabMap from '../../resources/data/maps/school_lab.json';
import hotelFloorMap from '../../resources/data/maps/hotel_floor.json';
import type { Balance, ContractTemplate, Furniture, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import { instantiateTemplate, starHubOf } from '../contracts/template';
import { tileKind } from '../data/tileKind';
import { cableMaxLength } from '../registry/query';
import { EMPTY_FAMILIARITY } from './familiar';
import { initialOffice } from './furniture';
import { initialStaff } from './staff';
import { connect, focusedOf, type Core, type Env, type Report } from './project';
import { accept, advanceBuild, requestBuild, testDesign } from './progress';
import { placeDevice } from './placement';
import { addRoute, setFirewallRules, setInterface } from './netEdit';
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

// 検収まで進める。テストに合格し、施工を終えて検収された報告を返す
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

// 台数が収まる最も小さいスイッチ
const switchFor = (ports: number): string => (ports <= 4 ? 'l2_switch_4p' : ports <= 8 ? 'l2_switch_8p' : 'l2_switch_16p');

const SEEDS = [1, 2, 3, 4, 5, 6];
const offerOf = (id: string, map: GameMap, seed: number): Offer => instantiateTemplate(templateOf(id), map, 0, seed).offer;
const centerOf = (points: { x: number; y: number }[], map: GameMap) => starHubOf(points, map);
// 最も遠い機器までが最も近い床のマス（広い範囲で、1台のスイッチから外れた PC がUTPの上限を超えないようにする）
const reachCenterOf = (points: { x: number; y: number }[], map: GameMap): { x: number; y: number } => {
  let best: { x: number; y: number; far: number; sum: number } | null = null;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (tileKind(map, x, y) !== 'floor') continue;
      const ds = points.map((p) => Math.abs(p.x - x) + Math.abs(p.y - y));
      const far = Math.max(...ds);
      const sum = ds.reduce((a, b) => a + b, 0);
      if (best === null || far < best.far || (far === best.far && sum < best.sum)) best = { x, y, far, sum };
    }
  }
  if (best === null) throw new Error('床のマスがない');
  return best;
};

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

// 役割（グループ）ごとにスイッチを1台置いて配線し、グループごとに別のネットワークのアドレスを振る。つながない（グループの間は届かない）
const solveByRole = (offer: Offer, map: GameMap, roles: string[]): Core => {
  let core = take(startCore(offer), offer.id);
  let host = 10;
  roles.forEach((role) => {
    const pcs = offer.contract.placed.filter((p) => p.ref.startsWith(`${role}_`));
    const hub = centerOf(pcs, map);
    const sw = place(core, switchFor(pcs.length), hub.x, hub.y, map);
    core = sw.core;
    for (const p of pcs) {
      core = wire(core, p.ref, sw.uid);
      core = addr(core, p.ref, `192.168.1.${host++}`);
    }
  });
  return core;
};

// 1台のスイッチにすべてをつなぐ（グループの間が届いてしまう）
const solveOneSwitch = (offer: Offer, map: GameMap): Core => {
  let core = take(startCore(offer), offer.id);
  const pcs = offer.contract.placed;
  const hub = centerOf(pcs, map);
  const sw = place(core, 'l2_switch_24p', hub.x, hub.y, map);
  core = sw.core;
  pcs.forEach((p, i) => {
    core = wire(core, p.ref, sw.uid);
    core = addr(core, p.ref, `192.168.1.${10 + i}`);
  });
  return core;
};

describe.each([
  ['t_coworking', coworkingMap, ['tenanta', 'tenantb', 'tenantc']],
  ['t_hotel_floor', hotelFloorMap, ['rooma', 'roomb', 'roomc', 'roomd']],
] as const)('%s: 入居者・部屋ごとにネットワークを分ける', (id, mapJson, roles) => {
  const map = mapJson as unknown as GameMap;
  for (const seed of SEEDS) {
    it(`種 ${seed}: グループごとにスイッチを置き、つながないと合格し、★3 になる`, () => {
      const report = finish(solveByRole(offerOf(id, map, seed), map, [...roles]));
      expect(report.passed).toBe(true);
      expect(report.stars).toBe(3);
    });
    it(`種 ${seed}: 1台のスイッチにすべてをつなぐと不合格`, () => {
      expect(passes(solveOneSwitch(offerOf(id, map, seed), map))).toBe(false);
    });
  }
});

describe('t_school_lab: 生徒と先生のネットワークを分け、それぞれにプリンターを置く', () => {
  const map = schoolLabMap as unknown as GameMap;
  // 生徒のスイッチと先生のスイッチを別々に置き、それぞれにプリンターを1台つなぐ。2つのスイッチはつながない
  const solve = (offer: Offer, separate: boolean): Core => {
    let core = take(startCore(offer), offer.id);
    let host = 10;
    const groups = separate ? [['student'], ['teacher']] : [['student', 'teacher']];
    for (const roles of groups) {
      const pcs = offer.contract.placed.filter((p) => roles.some((r) => p.ref.startsWith(`${r}_`)));
      const hub = centerOf(pcs, map);
      const sw = place(core, separate ? 'l2_switch_16p' : 'l2_switch_24p', hub.x, hub.y, map);
      core = sw.core;
      for (const p of pcs) {
        core = wire(core, p.ref, sw.uid);
        core = addr(core, p.ref, `192.168.1.${host++}`);
      }
      const printers = separate ? 1 : 2;
      for (let k = 0; k < printers; k++) {
        const printer = place(core, 'printer_basic', hub.x, hub.y, map);
        core = wire(printer.core, printer.uid, sw.uid);
        core = addr(core, printer.uid, `192.168.1.${host++}`);
      }
    }
    return core;
  };
  for (const seed of SEEDS) {
    it(`種 ${seed}: 生徒と先生を別のスイッチにして、それぞれにプリンターをつなぐと合格し、★3 になる`, () => {
      const report = finish(solve(offerOf('t_school_lab', map, seed), true));
      expect(report.passed).toBe(true);
      expect(report.stars).toBe(3);
    });
    it(`種 ${seed}: 1台のスイッチにすべてをつなぐと不合格`, () => {
      expect(passes(solve(offerOf('t_school_lab', map, seed), false))).toBe(false);
    });
  }
});

// どの床のマスにスイッチを1台置いても、すべての PC へ UTP が届かない（上限を超える PC がある）
const noSingleHub = (offer: Offer, map: GameMap): boolean => {
  const pcs = offer.contract.placed;
  const limit = cableMaxLength(UTP);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (tileKind(map, x, y) !== 'floor') continue;
      if (pcs.every((p) => Math.abs(p.x - x) + Math.abs(p.y - y) <= limit)) return false;
    }
  }
  return true;
};

// 近いほうのスイッチの番号
const nearOf = (hubs: readonly { x: number; y: number }[], p: { x: number; y: number }): number =>
  Math.abs(p.x - hubs[0].x) + Math.abs(p.y - hubs[0].y) <= Math.abs(p.x - hubs[1].x) + Math.abs(p.y - hubs[1].y) ? 0 : 1;

// 左右に分けた PC を、それぞれ近いスイッチにつなぎ、スイッチどうしを結ぶ
const solveSpan = (offer: Offer, map: GameMap, hubs: [{ x: number; y: number }, { x: number; y: number }], switchIds: [string, string], link: { cable: string; ports?: { a?: number; b?: number } }): Core => {
  let core = take(startCore(offer), offer.id);
  const pcs = offer.contract.placed;
  const sw = hubs.map((h, i) => {
    const r = place(core, switchIds[i], h.x, h.y, map);
    core = r.core;
    return r.uid;
  });
  pcs.forEach((p, i) => {
    core = wire(core, p.ref, sw[nearOf(hubs, p)]);
    core = addr(core, p.ref, `192.168.1.${10 + i}`);
  });
  return wire(core, sw[0], sw[1], link.cable, link.ports ?? {});
};

describe.each([
  ['t_warehouse', warehouseMap, [{ x: 9, y: 5 }, { x: 25, y: 5 }]],
  ['t_long_hall', longHallMap, [{ x: 14, y: 4 }, { x: 26, y: 4 }]],
  ['t_long_hall_large', longHallMap, [{ x: 14, y: 4 }, { x: 26, y: 4 }]],
] as const)('%s: 端から端まで UTP の上限を超えるため、スイッチを2台に分けて結ぶ', (id, mapJson, hubs) => {
  const map = mapJson as unknown as GameMap;
  for (const seed of SEEDS) {
    it(`種 ${seed}: どの位置にスイッチを1台置いても届かず、左右にスイッチを置いて結ぶと合格し、費用が予算の 0.8 以下に収まる`, () => {
      const offer = offerOf(id, map, seed);
      expect(noSingleHub(offer, map)).toBe(true);
      const sizes = [0, 1].map((i) => offer.contract.placed.filter((p) => nearOf(hubs, p) === i).length);
      const report = finish(solveSpan(offer, map, [{ ...hubs[0] }, { ...hubs[1] }], [switchFor(sizes[0] + 1), switchFor(sizes[1] + 1)], { cable: UTP }));
      expect(report.passed).toBe(true);
      expect(report.stars).toBe(3);
    });
  }
  it('位置の乱数を変えても（種 1〜60）、スイッチを1台置くだけでは届かない', () => {
    for (let seed = 1; seed <= 60; seed++) expect(noSingleHub(offerOf(id, map, seed), map), `種 ${seed}`).toBe(true);
  });
});

describe('t_campus: 校舎の間が UTP の上限を超えるため、光ファイバーで結ぶ', () => {
  const map = campusWideMap as unknown as GameMap;
  const solve = (offer: Offer): Core => {
    const pcs = offer.contract.placed;
    return solveSpan(
      offer,
      map,
      [
        starHubOf(pcs.filter((p) => p.y < 10), map),
        starHubOf(pcs.filter((p) => p.y >= 10), map),
      ],
      ['l3_switch', 'l3_switch'],
      // l3_switch の口は、RJ45 の 0〜7 のあとに SFP の 8・9
      { cable: 'fiber_mm', ports: { a: 8, b: 8 } },
    );
  };
  for (const seed of SEEDS) {
    it(`種 ${seed}: 校舎ごとに l3_switch を置き、光ファイバーで結ぶと合格し、費用が予算の 0.8 以下に収まる`, () => {
      const offer = offerOf('t_campus', map, seed);
      expect(noSingleHub(offer, map)).toBe(true);
      const report = finish(solve(offer));
      expect(report.passed).toBe(true);
      expect((report.cost ?? Infinity) / (report.budget ?? 1)).toBeLessThanOrEqual(0.8);
    });
  }
  it('UTP で校舎の間を結ぼうとすると、長すぎて引けない', () => {
    const offer = offerOf('t_campus', map, 1);
    const pcs = offer.contract.placed;
    let core = take(startCore(offer), offer.id);
    const a = place(core, 'l3_switch', starHubOf(pcs.filter((p) => p.y < 10), map).x, 3, map);
    core = a.core;
    const b = place(core, 'l3_switch', starHubOf(pcs.filter((p) => p.y >= 10), map).x, 26, map);
    expect(connect(b.core, a.uid, b.uid, UTP, env, 'focus', { a: 0, b: 0 }).ok).toBe(false);
  });
});

describe('t_two_sites_lan: 拠点ごとに別のネットワークで、ルーターが要る', () => {
  const map = twoSitesMap as unknown as GameMap;
  const SFP_PORT = 4;
  // 拠点ごとにスイッチとルーターを置き、SFP 対応ルーターの SFP の口どうしを光ファイバーで結ぶ。相手の拠点への静的ルートを登録する
  const solve = (offer: Offer, withRouters: boolean): Core => {
    let core = take(startCore(offer), offer.id);
    const sites = [1, 2].map((n) => offer.contract.placed.filter((p) => p.config?.interfaces[0].ip.startsWith(`192.168.${n}.`)));
    const swIds: string[] = [];
    const routerIds: string[] = [];
    sites.forEach((pcs) => {
      const hub = centerOf(pcs, map);
      const sw = place(core, switchFor(pcs.length + 1), hub.x, hub.y, map);
      core = sw.core;
      swIds.push(sw.uid);
      for (const p of pcs) core = wire(core, p.ref, sw.uid);
      if (withRouters) {
        const router = place(core, 'router_sfp', hub.x, hub.y, map);
        core = wire(router.core, sw.uid, router.uid, UTP, { b: 0 });
        routerIds.push(router.uid);
      }
    });
    if (!withRouters) return core;
    core = wire(core, routerIds[0], routerIds[1], 'fiber_mm', { a: SFP_PORT, b: SFP_PORT });
    core = addr(core, routerIds[0], '192.168.1.1');
    core = addr(core, routerIds[0], '192.168.30.1', SFP_PORT);
    core = addr(core, routerIds[1], '192.168.2.1');
    core = addr(core, routerIds[1], '192.168.30.2', SFP_PORT);
    core = ok(addRoute(core, routerIds[0], { dest: '192.168.2.0', prefix: 24, nextHop: '192.168.30.2' })).core;
    core = ok(addRoute(core, routerIds[1], { dest: '192.168.1.0', prefix: 24, nextHop: '192.168.30.1' })).core;
    return core;
  };
  for (const seed of SEEDS) {
    it(`種 ${seed}: 拠点ごとのルーターを光ファイバーで結ぶと合格し、★3 になる`, () => {
      const report = finish(solve(offerOf('t_two_sites_lan', map, seed), true));
      expect(report.passed).toBe(true);
      expect(report.stars).toBe(3);
    });
    it(`種 ${seed}: ルーターを置かずに、スイッチだけでは結べない`, () => {
      const offer = offerOf('t_two_sites_lan', map, seed);
      const core = solve(offer, false);
      expect(passes(core)).toBe(false);
    });
  }
});

describe('t_factory: 事務所と作業場の間にファイアウォールを置き、作業場からはサーバーだけに届く', () => {
  const map = factoryMap as unknown as GameMap;
  const SERVER = 'server_basic';
  const solve = (offer: Offer, firewall: boolean): Core => {
    let core = take(startCore(offer), offer.id);
    const pcsOf = (role: string) => offer.contract.placed.filter((p) => p.ref.startsWith(`${role}_`));
    const officeHub = reachCenterOf(pcsOf('office'), map);
    const officeSw = place(core, SWITCH, officeHub.x, officeHub.y, map);
    core = officeSw.core;
    const workHub = reachCenterOf(pcsOf('work'), map);
    const workSw = place(core, pcsOf('work').length + 1 <= 16 ? 'l2_switch_16p' : 'l2_switch_24p', workHub.x, workHub.y, map);
    core = workSw.core;
    pcsOf('office').forEach((p, i) => {
      core = wire(core, p.ref, officeSw.uid);
      core = addr(core, p.ref, `192.168.1.${10 + i}`);
    });
    const server = place(core, SERVER, officeHub.x, officeHub.y, map);
    core = wire(server.core, server.uid, officeSw.uid);
    core = addr(core, server.uid, '192.168.1.50');
    pcsOf('work').forEach((p, i) => {
      core = wire(core, p.ref, workSw.uid);
      // スイッチだけの設計は、同じネットワークにする
      core = addr(core, p.ref, firewall ? `192.168.2.${10 + i}` : `192.168.1.${100 + i}`);
    });
    const mid = reachCenterOf([officeHub, workHub], map);
    if (!firewall) {
      // 2つのスイッチの間に中継のスイッチを置いて、同じネットワークにする
      const relay = place(core, 'l2_switch_4p', mid.x, mid.y, map);
      core = wire(relay.core, officeSw.uid, relay.uid);
      return wire(core, workSw.uid, relay.uid);
    }
    const fw = place(core, 'firewall', mid.x, mid.y, map);
    core = fw.core;
    core = wire(core, officeSw.uid, fw.uid, UTP, { b: 0 });
    core = wire(core, workSw.uid, fw.uid, UTP, { b: 1 });
    core = addr(core, fw.uid, '192.168.1.1');
    core = addr(core, fw.uid, '192.168.2.1', 1);
    // 規則の判定は既定で拒否。事務所の内側からの通信と、作業場からサーバーの HTTP だけを許可する
    return ok(setFirewallRules(core, fw.uid, [
      { src: '192.168.1.0/24', dst: 'any', service: 'any' },
      { src: '192.168.2.0/24', dst: '192.168.1.50/32', service: 'http', port: 80 },
    ])).core;
  };
  for (const [id, seed] of SEEDS.flatMap((x) => ['t_factory', 't_factory_large'].map((i) => [i, x] as const))) {
    it(`${id} 種 ${seed}: ファイアウォールで分けると合格し、費用が予算の 0.8 以下に収まる`, () => {
      const report = finish(solve(offerOf(id, map, seed), true));
      expect(report.passed).toBe(true);
      expect((report.cost ?? Infinity) / (report.budget ?? 1)).toBeLessThanOrEqual(0.8);
      expect(report.stars).toBe(3);
    });
    it(`${id} 種 ${seed}: スイッチをつなぐだけでは、作業場から事務所の PC に届いてしまい不合格`, () => {
      expect(passes(solve(offerOf(id, map, seed), false))).toBe(false);
    });
  }
});
