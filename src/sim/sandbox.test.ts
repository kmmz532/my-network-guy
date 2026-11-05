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
import { SANDBOX_MONEY, SANDBOX_SIZE, sandboxClock, sandboxOffice, sandboxTest } from './sandbox';
import { connect, placeInOffice, setInterface, noEffects, type Core, type Env, type Office } from './project';
import { initialClock } from './clock';

const balance = balanceJson as Balance;

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
  it('床は 30 × 20 の1部屋で、機器も家具もない', () => {
    const office = sandboxOffice();
    expect(SANDBOX_SIZE).toEqual({ w: 30, h: 20 });
    expect(office.size).toEqual({ w: 30, h: 20 });
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
    expect(isUnlocked(locked, [], false)).toBe(false);
    expect(isUnlocked(locked, [], true)).toBe(true);
  });

  it('サンドボックスの倉庫には、解禁前の機材も並ぶ', () => {
    const shop = shopJson.items as ShopItem[];
    const owned = { l2_switch_8p: 1, sofa: 1 };
    expect(warehouseItems('office', shop, [], owned).map((i) => i.id)).toEqual(['sofa']);
    expect(warehouseItems('office', shop, [], owned, true).map((i) => i.id)).toEqual(['l2_switch_8p', 'sofa']);
  });
});
