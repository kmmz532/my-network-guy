import { EMPTY_FAMILIARITY } from './familiar';
// 模範解答のテスト。固定案件・定型案件ごとに、達成条件を満たす最小の構成を実際に組み、検収に通す。
// 費用は、案件に置いた機器の定価の合計と配線（connect）の費用（projectCostOf）を使う。
// 費用が予算の 60〜75% に入ることを確かめる（予算が高すぎると★の意味がなく、低すぎると★3 が取れないため）。
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';

import furnitureJson from '../assets/data/furniture.json';






import c001 from '../assets/data/contracts/c001_direct_link.json';
import c002 from '../assets/data/contracts/c002_small_office.json';
import c003 from '../assets/data/contracts/c003_departments.json';
import c004 from '../assets/data/contracts/c004_web_server.json';
import c005 from '../assets/data/contracts/c005_two_sites.json';
import c006 from '../assets/data/contracts/c006_office_external.json';
import i001 from '../assets/data/contracts/i001_office_lan.json';
import i002 from '../assets/data/contracts/i002_office_server.json';
import templateJson from '../assets/data/contracts/templates/t_small_lan.json';
import officeSmall from '../assets/data/maps/office_small.json';
import officeTwoRooms from '../assets/data/maps/office_two_rooms.json';
import officeTwoSites from '../assets/data/maps/office_two_sites.json';
import type { Balance, Contract, ContractTemplate, Furniture, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import { instantiateTemplate, starHubOf } from '../contracts/template';
import { initialOffice } from './furniture';
import { mapOfOffice } from './office';
import { buyDevice } from './shop';
import { initialStaff } from './staff';
import { connect, designIssues, focusedOf, type Core, type Env, type Report } from './project';
import { accept, advanceBuild, requestBuild, testDesign } from './progress';
import { placeDevice } from './placement';
import { addRoute, setFirewallRules, setInterface } from './netEdit';
import { deviceDef } from '../registry/query';

const balance = balanceJson as unknown as Balance;
const gameMinutesPerTick = balance.time.gameMinutesPerTick;

// 機材の性質（ゲームの定義と同じ。サーバーの既定のサービスを含む）
const env: Env = {
  balance,
  furniture: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
  engine: { wallAt: () => false },
};

const UTP = 'utp_cat5e';
const SWITCH = 'l2_switch_8p';
const ROUTER = 'router_basic';
// SFP 対応ルーターと、その SFP の口の番号（RJ45 の口0〜3の後）
const ROUTER_SFP = 'router_sfp';
const SFP_PORT = 4;
const FIREWALL = 'firewall';
const PC = 'pc_basic';
const SERVER = 'server_basic';

const smallMap = officeSmall as unknown as GameMap;
const roomsMap = officeTwoRooms as unknown as GameMap;
const sitesMap = officeTwoSites as unknown as GameMap;

const fixedOffer = (contract: unknown): Offer => {
  const c = contract as Contract;
  return { id: c.id, kind: 'fixed', baseId: c.id, params: {}, contract: c };
};

const startCore = (offers: Offer[]): Core => ({
  clock: { minute: 0, money: balance.startMoney, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
  offers,
  active: [],
  focus: null,
  office: initialOffice(balance),
  effects: { buildSpeed: 0 },
  staff: initialStaff(balance, 1).staff,
  staffSeq: 2,
  candidates: [],
  guidesDone: [],
  termsShown: [],
});

// 操作が成功したことを確かめ、成功の結果を返す（失敗なら例外）
const ok = <T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> => {
  if (!r.ok) throw new Error(`操作に失敗: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
};

// 案件を受注する（担当は社員全員）
const take = (core: Core, offerId: string): Core => {
  const crew = core.staff.map((s) => s.uid);
  return ok(accept(core, offerId, balance.office.projectSlots, crew)).core;
};

// 機材を1台買う。店の購入と同じく、費用には入れない（案件の費用は納品のとき、置かれている機器の定価から決める）
const buy = (core: Core, deviceId: string): Core => {
  const price = deviceDef(deviceId).price;
  const r = buyDevice(core.clock.money, core.owned, deviceId, price);
  if (!r.ok) throw new Error(`買えない: ${deviceId}`);
  return { ...core, clock: { ...core.clock, money: r.money }, owned: r.owned };
};

// 機材を置き、置いた機器のuidを返す
const place = (core: Core, deviceId: string, x: number, y: number, map: GameMap): { core: Core; uid: string } => {
  const next = ok(placeDevice(core, deviceId, x, y, map, env)).core;
  const nodes = focusedOf(next)!.nodes;
  const uid = nodes[nodes.length - 1].uid;
  return { core: next, uid };
};

const wire = (core: Core, a: string, b: string, cable = UTP, ports: { a?: number; b?: number } = {}): Core =>
  ok(connect(core, a, b, cable, env, 'focus', ports)).core;

const addr = (core: Core, uid: string, ip: string, port = 0): Core => ok(setInterface(core, uid, port, ip, 24, env)).core;

// 検収まで進める。テストに合格し、施工を終えて検収されるまで時間を進める。設計に不備がないことを確かめる（allowIssues が true なら確かめない）
const finish = (core: Core, allowIssues = false): { core: Core; report: Report } => {
  const tested = ok(testDesign(core, env));
  if (!tested.result.passed) throw new Error('テストに不合格');
  if (!allowIssues) expect(designIssues(focusedOf(tested.core)!, env)).toEqual({});
  let state = ok(requestBuild(tested.core, env)).core;
  for (let i = 0; i < 5000; i++) {
    const hour = Math.floor((state.clock.minute % (24 * 60)) / 60);
    const r = ok(advanceBuild(state, env, hour));
    if (r.report) return { core: r.core, report: r.report };
    state = { ...r.core, clock: { ...r.core.clock, minute: r.core.clock.minute + gameMinutesPerTick } };
  }
  throw new Error('施工が終わらない');
};

// 模範解答の判定。合格し、費用が予算の 60〜75% に入り、期日内の★3であること
const expectReference = (report: Report) => {
  expect(report.passed).toBe(true);
  expect(report.cost).toBeDefined();
  const ratio = (report.cost ?? 0) / (report.budget ?? 1);
  expect(ratio).toBeGreaterThanOrEqual(0.6);
  expect(ratio).toBeLessThanOrEqual(0.75);
  expect(report.stars).toBe(3);
  expect(report.lateDays).toBe(0);
};

describe('模範解答: 固定案件', () => {
  it('c001 PC2台の直結: PCどうしを1本の配線でつなぐ', () => {
    let core = take(startCore([fixedOffer(c001)]), 'c001_direct_link');
    core = addr(core, 'pc_a', '192.168.1.10');
    core = addr(core, 'pc_b', '192.168.1.11');
    core = wire(core, 'pc_a', 'pc_b');
    expectReference(finish(core).report);
  });

  it('c002 PC3台: 8ポートのスイッチを中央に置き、3台を配線する', () => {
    let core = take(startCore([fixedOffer(c002)]), 'c002_small_office');
    core = buy(core, SWITCH);
    const sw = place(core, SWITCH, 10, 4, smallMap);
    core = sw.core;
    core = wire(core, 'pc_a', sw.uid);
    core = wire(core, 'pc_b', sw.uid);
    core = wire(core, 'pc_c', sw.uid);
    core = addr(core, 'pc_a', '192.168.1.10');
    core = addr(core, 'pc_b', '192.168.1.11');
    core = addr(core, 'pc_c', '192.168.1.12');
    expectReference(finish(core).report);
  });

  it('c003 部署の分離: 部署ごとにスイッチを1台ずつ置き、ルーターで2つのネットワークをつなぐ', () => {
    let core = take(startCore([fixedOffer(c003)]), 'c003_departments');
    core = buy(core, ROUTER);
    core = buy(core, SWITCH);
    core = buy(core, SWITCH);
    const router = place(core, ROUTER, 9, 5, roomsMap);
    core = router.core;
    const swSales = place(core, SWITCH, 2, 5, roomsMap);
    core = swSales.core;
    const swDev = place(core, SWITCH, 17, 5, roomsMap);
    core = swDev.core;
    core = wire(core, 'sales_a', swSales.uid);
    core = wire(core, 'sales_b', swSales.uid);
    core = wire(core, swSales.uid, router.uid, UTP, { b: 0 });
    core = wire(core, 'dev_a', swDev.uid);
    core = wire(core, 'dev_b', swDev.uid);
    core = wire(core, swDev.uid, router.uid, UTP, { b: 1 });
    core = addr(core, router.uid, '192.168.1.1');
    core = addr(core, router.uid, '192.168.2.1', 1);
    expectReference(finish(core).report);
  });

  it('c003 の誤り: 部署をスイッチ1台にまとめ、ルーターの2つの口をそのスイッチにつなぐと、ループして不合格', () => {
    let core = take(startCore([fixedOffer(c003)]), 'c003_departments');
    core = buy(core, ROUTER);
    core = buy(core, SWITCH);
    const router = place(core, ROUTER, 9, 5, roomsMap);
    core = router.core;
    const sw = place(core, SWITCH, 12, 5, roomsMap);
    core = sw.core;
    for (const ref of ['sales_a', 'sales_b', 'dev_a', 'dev_b']) core = wire(core, ref, sw.uid);
    core = wire(core, sw.uid, router.uid, UTP, { b: 0 });
    core = wire(core, sw.uid, router.uid, UTP, { b: 1 });
    core = addr(core, router.uid, '192.168.1.1');
    core = addr(core, router.uid, '192.168.2.1', 1);
    // 2つの口が同じスイッチにつながると、配線がぐるっと輪になり、ブロードキャストが回り続けて不合格
    const tested = ok(testDesign(core, env));
    expect(tested.result.passed).toBe(false);
    expect(JSON.stringify(tested.result.goals)).toContain('link.loop');
  });

  it('c004 Webサーバー: 社員側だけスイッチを置き、ルーターからサーバーへ直接つなぐ', () => {
    let core = take(startCore([fixedOffer(c004)]), 'c004_web_server');
    core = buy(core, ROUTER);
    core = buy(core, SWITCH);
    const router = place(core, ROUTER, 9, 5, roomsMap);
    core = router.core;
    const sw = place(core, SWITCH, 2, 5, roomsMap);
    core = sw.core;
    core = wire(core, 'staff_a', sw.uid);
    core = wire(core, 'staff_b', sw.uid);
    core = wire(core, sw.uid, router.uid, UTP, { b: 0 });
    core = wire(core, router.uid, 'web', UTP, { a: 1 });
    core = addr(core, router.uid, '192.168.1.1');
    core = addr(core, router.uid, '192.168.10.1', 1);
    expectReference(finish(core).report);
  });

  it('c005 2拠点: 拠点ごとにスイッチとルーターを置き、SFP 対応ルーターの SFP の口どうしを光ファイバーで結んで、相手の拠点への静的ルートを登録する（拠点の間は UTP の20マスでは届かない・道路をまたぐ）', () => {
    let core = take(startCore([fixedOffer(c005)]), 'c005_two_sites');
    core = buy(core, ROUTER_SFP);
    core = buy(core, ROUTER_SFP);
    core = buy(core, SWITCH);
    core = buy(core, SWITCH);
    const routerA = place(core, ROUTER_SFP, 8, 5, sitesMap);
    core = routerA.core;
    const routerB = place(core, ROUTER_SFP, 31, 5, sitesMap);
    core = routerB.core;
    const swA = place(core, SWITCH, 2, 5, sitesMap);
    core = swA.core;
    const swB = place(core, SWITCH, 37, 5, sitesMap);
    core = swB.core;
    core = wire(core, 'hq_a', swA.uid);
    core = wire(core, 'hq_b', swA.uid);
    core = wire(core, swA.uid, routerA.uid, UTP, { b: 0 });
    // ルーターの口4は SFP。光ファイバーは SFP の口どうしだけを結べる
    core = wire(core, routerA.uid, routerB.uid, 'fiber_mm', { a: SFP_PORT, b: SFP_PORT });
    core = wire(core, routerB.uid, swB.uid, UTP, { a: 0 });
    core = wire(core, 'br_a', swB.uid);
    core = wire(core, 'br_b', swB.uid);
    core = addr(core, routerA.uid, '192.168.1.1');
    core = addr(core, routerA.uid, '192.168.30.1', SFP_PORT);
    core = addr(core, routerB.uid, '192.168.20.1');
    core = addr(core, routerB.uid, '192.168.30.2', SFP_PORT);
    core = ok(addRoute(core, routerA.uid, { dest: '192.168.20.0', prefix: 24, nextHop: '192.168.30.2' })).core;
    core = ok(addRoute(core, routerB.uid, { dest: '192.168.1.0', prefix: 24, nextHop: '192.168.30.1' })).core;
    expectReference(finish(core).report);
  });

  it('c006 外部接続: スイッチの先にファイアウォールを置き、外部のサーバーへつなぐ', () => {
    let core = take(startCore([fixedOffer(c006)]), 'c006_office_external');
    core = buy(core, FIREWALL);
    core = buy(core, SWITCH);
    const fw = place(core, FIREWALL, 9, 5, roomsMap);
    core = fw.core;
    const sw = place(core, SWITCH, 2, 5, roomsMap);
    core = sw.core;
    core = wire(core, 'staff_a', sw.uid);
    core = wire(core, 'staff_b', sw.uid);
    core = wire(core, sw.uid, fw.uid, UTP, { b: 0 });
    core = wire(core, fw.uid, 'web', UTP, { a: 1 });
    core = addr(core, fw.uid, '192.168.1.1');
    core = addr(core, fw.uid, '203.0.113.1', 1);
    // 規則: 社内から外部のWeb（80）だけを許可する。それ以外は既定で拒否される
    core = ok(setFirewallRules(core, fw.uid, [{ src: '192.168.1.0/24', dst: '203.0.113.0/24', service: 'http', port: 80 }])).core;
    expectReference(finish(core).report);
  });

  it('c006 外部接続: ルーターで通じても、ファイアウォールを通らなければ合格しない', () => {
    let core = take(startCore([fixedOffer(c006)]), 'c006_office_external');
    core = buy(core, ROUTER);
    core = buy(core, SWITCH);
    const router = place(core, ROUTER, 9, 5, roomsMap);
    core = router.core;
    const sw = place(core, SWITCH, 2, 5, roomsMap);
    core = sw.core;
    core = wire(core, 'staff_a', sw.uid);
    core = wire(core, 'staff_b', sw.uid);
    core = wire(core, sw.uid, router.uid, UTP, { b: 0 });
    core = wire(core, router.uid, 'web', UTP, { a: 1 });
    core = addr(core, router.uid, '192.168.1.1');
    core = addr(core, router.uid, '203.0.113.1', 1);
    const tested = ok(testDesign(core, env));
    expect(tested.result.passed).toBe(false);
  });

  it('i001 自社オフィスのLAN: 机の2台をスイッチにつなぐ（後の i002 でサーバーをつなげるよう、スイッチを置く）', () => {
    const { core } = buildI001(startCore([fixedOffer(i001), fixedOffer(i002)]));
    // 机の2台とスイッチ1台（回線終端は解放のレベルまで置かない）
    expect(core.office.nodes.length).toBe(3);
  });

  it('i002 自社オフィスのサーバー: i001 の後の自社オフィスに、サーバーを1台つなぐ', () => {
    const afterI001 = buildI001(startCore([fixedOffer(i001), fixedOffer(i002)])).core;
    let core = take(afterI001, 'i002_office_server');
    core = buy(core, SERVER);
    const map = mapOfOffice(core.office);
    const server = place(core, SERVER, 3, 4, map);
    core = server.core;
    // 机の間のスイッチ（自社オフィスの i001 で置いたもの）につなぐ
    const sw = focusedOf(core)!.nodes.find((n) => n.device === SWITCH)!;
    core = wire(core, server.uid, sw.uid);
    core = addr(core, server.uid, '192.168.1.20');
    expectReference(finish(core).report);
  });
});

// i001 の模範解答を組み、検収まで進める（自社オフィスに PC 2台とスイッチが残る）
function buildI001(start: Core): { core: Core; report: Report } {
  let core = take(start, 'i001_office_lan');
  core = buy(core, SWITCH);
  core = buy(core, PC);
  core = buy(core, PC);
  const map = mapOfOffice(core.office);
  // 机（2,3）と（4,3）に PC、その間の（3,3）にスイッチ
  const sw = place(core, SWITCH, 3, 3, map);
  core = sw.core;
  const pcA = place(core, PC, 2, 3, map);
  core = pcA.core;
  const pcB = place(core, PC, 4, 3, map);
  core = pcB.core;
  core = wire(core, pcA.uid, sw.uid);
  core = wire(core, pcB.uid, sw.uid);
  core = addr(core, pcA.uid, '192.168.1.10');
  core = addr(core, pcB.uid, '192.168.1.11');
  const done = finish(core);
  expectReference(done.report);
  return done;
}

describe('模範解答: 定型案件（t_small_lan）', () => {
  // 乱数の種を変えて、台数と配置の違う案件で確かめる（最悪の場合も、費用が予算の 75% 以下）
  for (const seed of [1, 2, 3, 4, 5]) {
    it(`種 ${seed}: スイッチを1台、配置の中央に置いて全機を配線する`, () => {
      const template = templateJson as unknown as ContractTemplate;
      const { offer } = instantiateTemplate(template, smallMap, 0, seed);
      let core = take(startCore([offer]), offer.id);
      core = buy(core, SWITCH);
      const hub = starHubOf(offer.contract.placed, smallMap);
      const sw = place(core, SWITCH, hub.x, hub.y, smallMap);
      core = sw.core;
      offer.contract.placed.forEach((p, i) => {
        core = wire(core, p.ref, sw.uid);
        core = addr(core, p.ref, `192.168.1.${10 + i}`);
      });
      expectReference(finish(core).report);
    });
  }
});
