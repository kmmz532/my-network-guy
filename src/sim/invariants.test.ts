// 操作の列を無作為に作り、操作のたびに不変条件を確かめる（N120）。失敗したときは、fast-check が操作の列を縮めて示す。
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import balanceJson from '../assets/data/balance.json';
import cablesJson from '../assets/data/cables.json';
import pcJson from '../assets/data/devices/pc.json';
import furnitureJson from '../assets/data/furniture.json';
import routerJson from '../assets/data/devices/router.json';
import switchJson from '../assets/data/devices/l2_switch.json';
import serverJson from '../assets/data/devices/server.json';
import officeJson from '../assets/data/maps/office_small.json';
import type { Balance, Furniture, GameMap } from '../data/schema';
import { EMPTY_FAMILIARITY } from './familiar';
import { initialStaff } from './staff';
import { checkInvariants } from './invariants';
import { connect, type Core, type Env, type Outcome } from './project';
import { moveNode, placeInOffice, removeFromOffice, removeLink, replugTo } from './placement';

const balance = balanceJson as unknown as Balance;
const map = officeJson as unknown as GameMap;

const devices: Env['devices'] = {};
for (const d of [...pcJson.devices, ...switchJson.devices, ...routerJson.devices, ...serverJson.devices]) {
  devices[d.id] = { category: d.category, price: d.price, portCount: d.ports.reduce((sum, p) => sum + p.count, 0) };
}
const cables: Env['cables'] = {};
for (const c of cablesJson.cables) cables[c.id] = { pricePerLink: c.pricePerLink, pricePerTile: c.pricePerTile, maxLengthTiles: c.maxLengthTiles };
const env: Env = {
  balance,
  furniture: Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture])),
  devices,
  cables,
  engine: { wallAt: () => false },
};

// 自社オフィスだけの開始状態（机が2つ、社員が2人）
const start = (): Core => ({
  clock: { minute: 0, money: 1_000_000, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned: { pc_basic: 3, l2_switch_8p: 2 },
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
  offers: [],
  active: [],
  focus: null,
  office: { bought: ['wood' as const],
    segments: {},
    size: { w: 5, h: 5 },
    innerWalls: [],
    doors: [],
    annexes: [],
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
  staff: initialStaff(balance, 1).staff.map((s, i) => ({ ...s, desk: i === 0 ? 'f0' : i === 1 ? 'f1' : null })),
  staffSeq: 2,
  candidates: [],
  guidesDone: [],
  termsShown: [],
});

// 操作の種類。番号は、いまある機器・配線の一覧を巡回して使う
type Action =
  | { kind: 'place'; device: 'pc_basic' | 'l2_switch_8p'; x: number; y: number }
  | { kind: 'connect'; a: number; b: number }
  | { kind: 'removeNode'; i: number }
  | { kind: 'removeLink'; i: number }
  | { kind: 'move'; i: number; x: number; y: number }
  | { kind: 'replug'; i: number; end: 'a' | 'b'; node: number };

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ kind: fc.constant('place' as const), device: fc.constantFrom('pc_basic' as const, 'l2_switch_8p' as const), x: fc.integer({ min: 0, max: 4 }), y: fc.integer({ min: 0, max: 4 }) }),
  fc.record({ kind: fc.constant('connect' as const), a: fc.nat(10), b: fc.nat(10) }),
  fc.record({ kind: fc.constant('removeNode' as const), i: fc.nat(10) }),
  fc.record({ kind: fc.constant('removeLink' as const), i: fc.nat(10) }),
  fc.record({ kind: fc.constant('move' as const), i: fc.nat(10), x: fc.integer({ min: 0, max: 4 }), y: fc.integer({ min: 0, max: 4 }) }),
  fc.record({ kind: fc.constant('replug' as const), i: fc.nat(10), end: fc.constantFrom('a' as const, 'b' as const), node: fc.nat(10) }),
);

// 1つの操作を適用する。失敗（ok: false）のときは状態を変えない
const apply = (core: Core, action: Action): Outcome => {
  const nodes = core.office.nodes;
  const links = core.office.links;
  const pick = <T,>(list: readonly T[], i: number): T | undefined => (list.length === 0 ? undefined : list[i % list.length]);
  switch (action.kind) {
    case 'place':
      return placeInOffice(core, action.device, action.x, action.y, map, env);
    case 'connect': {
      const a = pick(nodes, action.a);
      const b = pick(nodes, action.b);
      if (!a || !b) return { ok: false, reason: 'none' };
      return connect(core, a.uid, b.uid, 'utp_cat5e', env, 'office');
    }
    case 'removeNode': {
      const n = pick(nodes, action.i);
      return n ? removeFromOffice(core, n.uid, env) : { ok: false, reason: 'none' };
    }
    case 'removeLink': {
      const l = pick(links, action.i);
      return l ? removeLink(core, l.uid, 'office', env) : { ok: false, reason: 'none' };
    }
    case 'move': {
      const n = pick(nodes, action.i);
      return n ? moveNode(core, n.uid, action.x, action.y, env, 'office', map) : { ok: false, reason: 'none' };
    }
    case 'replug': {
      const l = pick(links, action.i);
      const n = pick(nodes, action.node);
      return l && n ? replugTo(core, l.uid, action.end, n.uid, null, env, 'office') : { ok: false, reason: 'none' };
    }
  }
};

describe('不変条件（操作の列の試験）', () => {
  it('開始状態は不変条件を守る', () => {
    expect(checkInvariants(start(), env)).toEqual([]);
  });

  it('どんな操作の列のあとも、自社オフィスの不変条件が破れない', () => {
    let succeeded = 0;
    fc.assert(
      fc.property(fc.array(actionArb, { maxLength: 40 }), (actions) => {
        let core = start();
        for (const action of actions) {
          const result = apply(core, action);
          if (result.ok) {
            succeeded++;
            core = result.core;
          }
          const violations = checkInvariants(core, env);
          if (violations.length > 0) throw new Error(`${JSON.stringify(action)} のあと: ${violations.join(' / ')}`);
        }
      }),
      { numRuns: 300, seed: 20261107 },
    );
    // 試験が意味を持つよう、成功した操作が実際に起きていること（全部失敗では不変条件を確かめたことにならない）
    expect(succeeded).toBeGreaterThan(100);
  });
});

// 規則ごとに、破ると違反が出ることを確かめる（変異試験で生き残った条件を殺すため）
describe('不変条件の違反（規則ごと）', () => {
  const link = (uid: string, a: string, port: number, b: string, paid = 0) => ({ uid, cable: 'utp_cat5e', a: { node: a, port }, b: { node: b, port: 0 }, path: [], paid });
  const node = (uid: string, x = 0) => ({ uid, device: 'pc_basic', x, y: 0, locked: false, configLocked: false, ports: [], interfaces: [], gateway: null, routes: [], services: [] });
  const withOffice = (nodes: ReturnType<typeof node>[], links: ReturnType<typeof link>[]): Core => {
    const core = start();
    return { ...core, office: { ...core.office, nodes, links } } as Core;
  };

  it('開始状態は違反なし（基準）', () => {
    expect(checkInvariants(withOffice([node('a'), node('b', 1)], [link('l0', 'a', 0, 'b')]), env)).toEqual([]);
  });

  it('資金が負なら違反', () => {
    const core = start();
    expect(checkInvariants({ ...core, clock: { ...core.clock, money: -1 } }, env).join(' ')).toContain('資金が負');
  });

  it('機器の uid が重なると違反', () => {
    expect(checkInvariants(withOffice([node('a'), node('a', 1)], []), env).join(' ')).toContain('機器の uid が重なる');
  });

  it('配線の uid が重なると違反', () => {
    const nodes = [node('a'), node('b', 1)];
    expect(checkInvariants(withOffice(nodes, [link('l0', 'a', 0, 'b'), link('l0', 'a', 1, 'b')]), env).join(' ')).toContain('配線の uid が重なる');
  });

  it('両端の機器がないと違反', () => {
    expect(checkInvariants(withOffice([node('a')], [link('l0', 'a', 0, 'zz')]), env).join(' ')).toContain('zz がない');
  });

  it('ポートの番号が機器の範囲の外だと違反', () => {
    expect(checkInvariants(withOffice([node('a'), node('b', 1)], [link('l0', 'a', 99, 'b')]), env).join(' ')).toContain('範囲外');
  });

  it('1つのポートに2本つなぐと違反', () => {
    const nodes = [node('a'), node('b', 1), node('c', 2)];
    expect(checkInvariants(withOffice(nodes, [link('l0', 'a', 0, 'b'), link('l1', 'a', 0, 'c')]), env).join(' ')).toContain('2本のケーブル');
  });

  it('払った額が負だと違反', () => {
    const nodes = [node('a'), node('b', 1)];
    expect(checkInvariants(withOffice(nodes, [link('l0', 'a', 0, 'b', -5)]), env).join(' ')).toContain('払った額が負');
  });

  it('担当が社員にいないと違反', () => {
    const core = start();
    const project = { id: 'p1', nodes: [], links: [], crew: ['nobody'], phase: 'design' } as unknown as Core['active'][number];
    expect(checkInvariants({ ...core, active: [project] }, env).join(' ')).toContain('担当 nobody がいない');
  });

  it('内勤の社員を担当にすると違反', () => {
    const core = start();
    const clerk = { ...core.staff[0], uid: 'clerk', job: 'sales' as const };
    const project = { id: 'p1', nodes: [], links: [], crew: ['clerk'], phase: 'design' } as unknown as Core['active'][number];
    expect(checkInvariants({ ...core, staff: [...core.staff, clerk], active: [project] }, env).join(' ')).toContain('が内勤');
  });

  it('同じ社員が2つの案件の担当だと違反', () => {
    const core = start();
    const uid = core.staff[0].uid;
    const p1 = { id: 'p1', nodes: [], links: [], crew: [uid], phase: 'design' } as unknown as Core['active'][number];
    const p2 = { ...p1, id: 'p2' };
    expect(checkInvariants({ ...core, active: [p1, p2] }, env).join(' ')).toContain('の両方にいる');
  });

  it('見ている案件が進行中でないと違反', () => {
    expect(checkInvariants({ ...start(), focus: 'ghost' }, env).join(' ')).toContain('進行中でない');
  });
});
