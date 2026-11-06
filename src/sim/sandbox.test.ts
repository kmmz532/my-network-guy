import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import cablesJson from '../assets/data/cables.json';
import pcJson from '../assets/data/devices/pc.json';
import routerJson from '../assets/data/devices/router.json';
import switchJson from '../assets/data/devices/l2_switch.json';
import serverJson from '../assets/data/devices/server.json';
import shopJson from '../assets/data/shop.json';
import type { Balance, GameMap, ShopItem } from '../data/schema';
import { isUnlocked } from './shop';
import { warehouseItems } from './warehouse';
import { mapOfOffice } from './office';
import { SANDBOX_DEFAULT_SIZE, SANDBOX_MONEY, SANDBOX_SIZES, resizeSandboxOffice, sandboxClock, sandboxOffice, sandboxTest } from './sandbox';
import { connect, placeInOffice, setInterface, noEffects, type Core, type Env, type Office } from './project';
import { initialClock } from './clock';
import { placeFurniture } from './furniture';

const balance = balanceJson as unknown as Balance;

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
  devices,
  cables,
  engine: {
    categoryOf: (device) => devices[device]?.category ?? 'unknown',
    maxLengthOf: (cable) => cables[cable]?.maxLengthTiles ?? 0,
  },
};

const core = (office: Office = sandboxOffice(), owned: Record<string, number> = { pc_basic: 4, server_basic: 1, router_basic: 1 }): Core => ({
  clock: sandboxClock(initialClock(balance)),
  companyExp: 0,
  reputation: 0,
  owned,
  completed: [],
  offers: [],
  active: [],
  focus: null,
  office,
  effects: noEffects(),
  staff: [],
  staffSeq: 0,
  candidates: [],
  guidesDone: [],
});

const mapOf = (office: Office): GameMap => mapOfOffice(office);

// 機器を置いて、ok なら核の状態を返す（テストの準備）
const place = (c: Core, device: string, x: number, y: number, floor = true): Core => {
  const r = placeInOffice(c, device, x, y, mapOf(c.office), env, floor);
  if (!r.ok) throw new Error(`置けない: ${r.reason}`);
  return r.core;
};

describe('サンドボックスの床', () => {
  it('床は既定の 15 × 10 の1部屋で、機器も家具もない', () => {
    const office = sandboxOffice();
    expect(SANDBOX_DEFAULT_SIZE).toEqual({ w: 15, h: 10 });
    expect(office.size).toEqual({ w: 15, h: 10 });
    expect(office.nodes).toEqual([]);
    expect(office.furniture).toEqual([]);
    expect(office.annexes).toEqual([]);
  });

  it('資金は十分にあり、時間は止めた状態で始まる', () => {
    const clock = sandboxClock(initialClock(balance));
    expect(clock.money).toBe(SANDBOX_MONEY);
    expect(clock.bankrupt).toBe(false);
  });
});

describe('サンドボックスの広さ', () => {
  it('選べる広さは 10×8・15×10・20×15・30×20', () => {
    expect(SANDBOX_SIZES).toEqual([
      { w: 10, h: 8 },
      { w: 15, h: 10 },
      { w: 20, h: 15 },
      { w: 30, h: 20 },
    ]);
  });

  it('指定した広さで床を作る', () => {
    expect(sandboxOffice({ w: 20, h: 15 }).size).toEqual({ w: 20, h: 15 });
    expect(mapOf(sandboxOffice({ w: 10, h: 8 })).width).toBe(12);
  });

  it('広げるのは、機器があってもできる', () => {
    const c = place(core(), 'pc_basic', 9, 7);
    const r = resizeSandboxOffice(c.office, { w: 30, h: 20 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.office.size).toEqual({ w: 30, h: 20 });
  });

  it('狭めるとき、はみ出す機器があれば変えられない', () => {
    const c = place(core(), 'pc_basic', 12, 3);
    expect(resizeSandboxOffice(c.office, { w: 10, h: 8 })).toEqual({ ok: false, reason: 'shrink' });
  });

  it('狭めるとき、はみ出す家具があれば変えられない', () => {
    const c = core(sandboxOffice(), { pc_basic: 4, plant: 1 });
    const withPlant = placeFurniture(c, 'plant', 1, 8, mapOf(c.office));
    if (!withPlant.ok) throw new Error(withPlant.reason);
    expect(resizeSandboxOffice(withPlant.core.office, { w: 10, h: 7 })).toEqual({ ok: false, reason: 'shrink' });
    expect(resizeSandboxOffice(withPlant.core.office, { w: 10, h: 8 }).ok).toBe(true);
  });

  it('はみ出さなければ狭められる', () => {
    const c = place(core(), 'pc_basic', 3, 3);
    const r = resizeSandboxOffice(c.office, { w: 10, h: 8 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.office.size).toEqual({ w: 10, h: 8 });
  });
});

describe('サンドボックスの配置', () => {
  it('床に PC を置ける（机がなくてもよい）', () => {
    const c = core();
    expect(placeInOffice(c, 'pc_basic', 3, 3, mapOf(c.office), env, true).ok).toBe(true);
  });

  it('サンドボックス以外では、PC は机の上でなければ置けない', () => {
    const c = core();
    const r = placeInOffice(c, 'pc_basic', 3, 3, mapOf(c.office), env);
    expect(r).toEqual({ ok: false, reason: 'desk' });
  });

  it('床に置いた機器の上には、もう1台置けない', () => {
    const c = place(core(), 'pc_basic', 3, 3);
    const r = placeInOffice(c, 'server_basic', 3, 3, mapOf(c.office), env, true);
    expect(r).toEqual({ ok: false, reason: 'tile' });
  });

  it('サンドボックスでは、PC を机の上に置ける', () => {
    const c0 = core(sandboxOffice(), { pc_basic: 4, desk: 1 });
    const map = mapOf(c0.office);
    const withDesk = placeFurniture(c0, 'desk', 2, 3, map);
    if (!withDesk.ok) throw new Error(withDesk.reason);
    expect(placeInOffice(withDesk.core, 'pc_basic', 2, 3, map, env, true).ok).toBe(true);
  });

  it('サンドボックスでも、机以外の家具の上には PC を置けない', () => {
    const c0 = core(sandboxOffice(), { pc_basic: 4, plant: 1 });
    const map = mapOf(c0.office);
    const withPlant = placeFurniture(c0, 'plant', 3, 3, map);
    if (!withPlant.ok) throw new Error(withPlant.reason);
    expect(placeInOffice(withPlant.core, 'pc_basic', 3, 3, map, env, true)).toEqual({ ok: false, reason: 'tile' });
  });

  it('サンドボックスでも、机の上に機器があれば PC は置けない', () => {
    const c0 = core(sandboxOffice(), { pc_basic: 4, desk: 1 });
    const map = mapOf(c0.office);
    const withDesk = placeFurniture(c0, 'desk', 2, 3, map);
    if (!withDesk.ok) throw new Error(withDesk.reason);
    const c = place(withDesk.core, 'pc_basic', 2, 3);
    expect(placeInOffice(c, 'pc_basic', 2, 3, map, env, true)).toEqual({ ok: false, reason: 'tile' });
  });

  it('サンドボックスの床の外には置けない', () => {
    const c = core();
    const map = mapOf(c.office);
    expect(placeInOffice(c, 'pc_basic', map.width, 1, map, env, true)).toEqual({ ok: false, reason: 'tile' });
  });
});

describe('サンドボックスのテスト', () => {
  it('判定できる機器がなければ null', () => {
    const c = place(core(), 'router_basic', 3, 3);
    expect(sandboxTest(c.office, env)).toBeNull();
  });

  it('IPアドレスを設定して配線した PC どうしは、ping が通る', () => {
    let c = place(place(core(), 'pc_basic', 3, 3), 'pc_basic', 5, 3);
    const r = connect(c, 'u0', 'u1', 'utp_cat5e', env, 'office');
    if (!r.ok) throw new Error(r.reason);
    c = r.core;
    const a = setInterface(c, 'u0', 0, '192.168.1.10', 24, env, 'office');
    const b = setInterface(a.ok ? a.core : c, 'u1', 0, '192.168.1.11', 24, env, 'office');
    if (!b.ok) throw new Error(b.reason);
    const result = sandboxTest(b.core.office, env);
    expect(result?.passed).toBe(true);
    expect(result?.goals).toHaveLength(1);
    expect(result?.traces.map((t) => t.kind)).toEqual(['ping']);
  });

  it('配線していない PC どうしは、ping が通らないと判定する', () => {
    const c = place(place(core(), 'pc_basic', 3, 3), 'pc_basic', 5, 3);
    const result = sandboxTest(c.office, env);
    expect(result?.passed).toBe(false);
    expect(result?.goals[0].ok).toBe(false);
    expect(result?.goals[0].failures.length).toBeGreaterThan(0);
  });
});

describe('サンドボックスの解禁と倉庫', () => {
  const locked = shopJson.items.find((i) => i.device === 'l2_switch_8p') as ShopItem;

  it('解禁の条件のある品目も、サンドボックスでは買える', () => {
    expect(isUnlocked(locked, 1, { devices: { l2_switch_8p: { unlockLevel: 2 } }, furniture: {}, cables: {} }, false)).toBe(false);
    expect(isUnlocked(locked, 1, { devices: { l2_switch_8p: { unlockLevel: 2 } }, furniture: {}, cables: {} }, true)).toBe(true);
  });

  it('サンドボックスの倉庫には、解禁前の機材も、持っていれば並ぶ', () => {
    const catalog = { devices: { l2_switch_8p: {} }, furniture: { sofa: {} }, shopOrder: ['l2_switch_8p', 'sofa'] };
    const owned = { l2_switch_8p: 1, sofa: 1 };
    expect(warehouseItems('office', owned, catalog).map((i) => i.id)).toEqual(['l2_switch_8p', 'sofa']);
  });
});
