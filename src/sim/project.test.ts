import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import cablesJson from '../assets/data/cables.json';
import pcJson from '../assets/data/devices/pc.json';
import routerJson from '../assets/data/devices/router.json';
import switchJson from '../assets/data/devices/l2_switch.json';
import serverJson from '../assets/data/devices/server.json';
import c001 from '../assets/data/contracts/c001_direct_link.json';
import officeJson from '../assets/data/maps/office_small.json';
import type { Balance, Contract, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import {
  accept,
  advanceBuild,
  checkConnect,
  connect,
  placeDevice,
  requestBuild,
  setInterface,
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
  active: null,
});

// 結果が成功していることを確認して、その状態を返す
const ok = (r: ReturnType<typeof accept>) => {
  if (!r.ok) throw new Error(`失敗: ${r.reason}`);
  return r;
};

describe('案件の流れ: c001 PC2台の直結', () => {
  it('IPを設定して配線し、施工すると検収に合格して納品される', () => {
    let core = ok(accept(start(), 'c001_direct_link')).core;
    expect(core.active?.phase).toBe('design');
    expect(core.offers).toEqual([]);

    core = ok(setInterface(core, 'pc_a', 0, '192.168.1.10', 24)).core;
    core = ok(setInterface(core, 'pc_b', 0, '192.168.1.11', 24)).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    // 配線費用: 1000 + 300 × 7タイル
    expect(core.clock.money).toBe(1_000_000 - 3100);

    core = ok(requestBuild(core, env)).core;
    expect(core.active?.total).toBe(7 * balance.build.minutesPerCableTile);

    // 勤務時間内の1Tickで施工が終わり、検収に合格する
    const done = ok(advanceBuild(core, env, balance.build.workStartHour));
    expect(done.report?.passed).toBe(true);
    expect(done.report?.stars).toBe(3);
    expect(done.core.active).toBeNull();
    expect(done.core.completed).toEqual(['c001_direct_link']);
    expect(done.core.clock.money).toBe(1_000_000 - 3100 + 30000);
    expect(done.core.reputation).toBe(1 + 3 * balance.reputationPerStar);
  });

  it('IPが未設定のまま施工すると不合格になり、設計に戻る', () => {
    let core = ok(accept(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    core = ok(requestBuild(core, env)).core;
    const r = ok(advanceBuild(core, env, balance.build.workStartHour));
    expect(r.report?.passed).toBe(false);
    expect(r.report?.failures.map((f) => f.reason)).toContain('ip.unset');
    expect(r.core.active?.phase).toBe('design');
    expect(r.core.active?.rework).toBe(1);
    expect(r.core.completed).toEqual([]);
  });

  it('勤務時間外は施工が進まない', () => {
    let core = ok(accept(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    core = ok(requestBuild(core, env)).core;
    const r = ok(advanceBuild(core, env, 3));
    expect(r.core.active?.progress).toBe(0);
    expect(r.report).toBeUndefined();
  });

  it('受注は1件まで', () => {
    const core = ok(accept(start(), 'c001_direct_link')).core;
    expect(accept(core, 'c001_direct_link')).toEqual({ ok: false, reason: 'busy' });
  });
});

describe('機器の配置と配線', () => {
  it('在庫がないと配置できない', () => {
    const core = ok(accept(start(), 'c001_direct_link')).core;
    expect(placeDevice(core, 'l2_switch_8p', 5, 5, map, env)).toEqual({ ok: false, reason: 'stock' });
  });

  it('壁のマスには置けない', () => {
    let core = ok(accept(start(), 'c001_direct_link')).core;
    core = { ...core, owned: { l2_switch_8p: 1 } };
    expect(placeDevice(core, 'l2_switch_8p', 0, 0, map, env)).toEqual({ ok: false, reason: 'tile' });
  });

  it('配置すると在庫が減る', () => {
    let core = ok(accept(start(), 'c001_direct_link')).core;
    core = { ...core, owned: { l2_switch_8p: 1 } };
    const r = ok(placeDevice(core, 'l2_switch_8p', 6, 6, map, env));
    expect(r.core.owned.l2_switch_8p).toBe(0);
    expect(r.core.active?.nodes.some((n) => n.uid === 'u0' && n.x === 6)).toBe(true);
  });

  it('IPアドレスの形式が不正なら設定しない', () => {
    const core = ok(accept(start(), 'c001_direct_link')).core;
    expect(setInterface(core, 'pc_a', 0, '192.168.1.300', 24)).toEqual({ ok: false, reason: 'ip' });
  });

  it('ケーブルの上限長を超える配線はできない', () => {
    const core = ok(accept(start(), 'c001_direct_link')).core;
    // pc_a (3,4) と pc_b (10,4) は7タイル。上限を超えるケーブルがないため、距離だけ確かめる
    const short = { ...env, cables: { utp_cat5e: { pricePerLink: 0, pricePerTile: 0, maxLengthTiles: 3 } } };
    expect(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', short)).toEqual({ ok: false, reason: 'cable' });
  });
});

describe('配線できるかの判定', () => {
  it('自分自身には配線できない', () => {
    const core = ok(accept(start(), 'c001_direct_link')).core;
    expect(checkConnect(core, 'pc_a', 'pc_a', 'utp_cat5e', env)).toBe('none');
  });

  it('できる場合は理由を返さない', () => {
    const core = ok(accept(start(), 'c001_direct_link')).core;
    expect(checkConnect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).toBeNull();
  });

  it('PCのポートが埋まっていると配線できない', () => {
    let core = ok(accept(start(), 'c001_direct_link')).core;
    core = ok(connect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).core;
    core = { ...core, owned: { l2_switch_8p: 1 } };
    expect(checkConnect(core, 'pc_a', 'pc_b', 'utp_cat5e', env)).toBe('port');
  });
});
