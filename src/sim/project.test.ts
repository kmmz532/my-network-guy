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
  abandon,
  accept,
  advanceBuild,
  checkConnect,
  connect,
  placeDevice,
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
  office: { nodes: [], links: [], seq: 0, furniture: [], furnitureSeq: 0 },
  effects: { buildSpeed: 0 },
  staff: 2,
});

// 結果が成功していることを確認して、その状態を返す
const ok = (r: ReturnType<typeof accept>) => {
  if (!r.ok) throw new Error(`失敗: ${r.reason}`);
  return r;
};

describe('案件の流れ: c001 PC2台の直結', () => {
  it('色を塗って配線し、施工すると検収に合格して納品される', () => {
    let core = ok(accept(start(), 'c001_direct_link')).core;
    expect(core.active?.phase).toBe('design');
    expect(core.offers).toEqual([]);

    core = ok(setColor(core, 'pc_a', 0, 1)).core;
    core = ok(setColor(core, 'pc_b', 0, 1)).core;
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
    expect(done.report?.reputationGain).toBe(1 + 3 * balance.reputationPerStar);
  });

  it('色を塗らずに施工すると不合格になり、設計に戻る', () => {
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

  it('設定が固定された機器の色は変えられない', () => {
    const core = ok(accept(start(), 'c001_direct_link')).core;
    const locked = { ...core, active: { ...core.active!, nodes: core.active!.nodes.map((n) => ({ ...n, configLocked: true })) } };
    expect(setColor(locked, 'pc_a', 0, 2)).toEqual({ ok: false, reason: 'locked' });
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
    const accepted = ok(accept(core, inhouse.id)).core;
    expect(placeDevice(accepted, 'pc_basic', 6, 6, map, env)).toEqual({ ok: false, reason: 'desk' });
  });

  it('自社案件では、机の上にPCを置ける', () => {
    const core: Core = {
      ...start(),
      offers: [inhouseOffer],
      owned: { pc_basic: 1 },
      office: { nodes: [], links: [], seq: 0, furniture: [desk(6, 6)], furnitureSeq: 1 },
    };
    const accepted = ok(accept(core, inhouse.id)).core;
    expect(ok(placeDevice(accepted, 'pc_basic', 6, 6, map, env)).core.active?.nodes).toHaveLength(1);
  });

  it('自社案件では、家具のマスに機器を置けない', () => {
    const core: Core = {
      ...start(),
      offers: [inhouseOffer],
      owned: { l2_switch_8p: 1 },
      office: { nodes: [], links: [], seq: 0, furniture: [{ uid: 'f0', id: 'plant', x: 6, y: 6 }], furnitureSeq: 1 },
    };
    const accepted = ok(accept(core, inhouse.id)).core;
    expect(placeDevice(accepted, 'l2_switch_8p', 6, 6, map, env)).toEqual({ ok: false, reason: 'tile' });
  });

  it('自社案件でない案件では、床にPCを置ける', () => {
    const core: Core = { ...start(), owned: { pc_basic: 1 } };
    const accepted = ok(accept(core, offer.id)).core;
    const before = accepted.active?.nodes.length ?? 0;
    expect(ok(placeDevice(accepted, 'pc_basic', 6, 6, map, env)).core.active?.nodes).toHaveLength(before + 1);
  });

  it('納品したネットワークが自社オフィスに残り、次の自社案件に引き継がれる', () => {
    let core: Core = {
      ...start(),
      offers: [inhouseOffer],
      owned: { pc_basic: 2 },
      office: { nodes: [], links: [], seq: 0, furniture: [desk(3, 4), desk(8, 4)], furnitureSeq: 2 },
    };
    core = ok(accept(core, inhouse.id)).core;
    core = ok(placeDevice(core, 'pc_basic', 3, 4, map, env)).core;
    core = ok(placeDevice(core, 'pc_basic', 8, 4, map, env)).core;
    core = ok(setColor(core, 'u0', 0, 1)).core;
    core = ok(setColor(core, 'u1', 0, 1)).core;
    core = ok(connect(core, 'u0', 'u1', 'utp_cat5e', env)).core;
    core = ok(requestBuild(core, env)).core;
    let r = ok(advanceBuild(core, env, balance.build.workStartHour));
    for (let i = 0; i < 20 && r.core.active; i++) r = ok(advanceBuild(r.core, env, balance.build.workStartHour));
    expect(r.report?.passed).toBe(true);
    expect(r.core.office.nodes.map((n) => n.uid)).toEqual(['u0', 'u1']);
    expect(r.core.office.links).toHaveLength(1);
    expect(r.core.effects.buildSpeed).toBeCloseTo(0.2);

    // 次の自社案件は、残ったネットワークから始まり、uid は重ならない
    const next = ok(accept({ ...r.core, offers: [{ ...inhouseOffer, id: 'again' }] }, 'again')).core;
    expect(next.active?.nodes.map((n) => n.uid)).toEqual(['u0', 'u1']);
    expect(next.active?.seq).toBe(r.core.office.seq);
    // 取り消しても、引き継いだ機器は在庫に戻らない
    expect(ok(abandon(next)).core.owned.pc_basic ?? 0).toBe(0);
  });
});
