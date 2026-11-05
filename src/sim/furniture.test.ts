import { describe, expect, it } from 'vitest';
import type { GameMap } from '../data/schema';
import type { NetNode } from '../network/types';
import { hire, placeFurniture, removeFurniture, seatCount } from './furniture';
import { createStaff } from './staff';
import { emptyOffice, noEffects, placeInOffice, type Core, type Env } from './project';

// 1行目は床・2行目の(1,1)は壁。机は(1,0)に置いておく
const map = {
  id: 'test',
  width: 4,
  height: 3,
  tileSize: 32,
  legend: { '.': 'floor', '#': 'wall' },
  tiles: ['....', '.#..', '....'],
} as unknown as GameMap;

const env = {
  devices: {
    pc_basic: { category: 'pc', price: 80000, portCount: 1 },
    server_basic: { category: 'server', price: 300000, portCount: 1 },
  },
} as unknown as Env;

const node = (uid: string, device: string, x: number, y: number): NetNode => ({
  uid,
  device,
  x,
  y,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
});

const core = (over: Partial<Core> = {}): Core => ({
  clock: { minute: 0, money: 1000000, paidMonths: 0, bankrupt: false },
  reputation: 0,
  owned: {},
  completed: [],
  offers: [],
  active: null,
  office: { ...emptyOffice(), furniture: [{ uid: 'f0', id: 'desk', x: 1, y: 0 }], furnitureSeq: 1 },
  effects: noEffects(),
  staff: [createStaff({ job: 'network', level: 1, salary: 200000 }, 1, 0).staff],
  staffSeq: 1,
  ...over,
});

const reasonOf = (o: { ok: boolean; reason?: string }) => (o.ok ? null : o.reason);

describe('家具を置く', () => {
  it('在庫がなければ置けない（stock）', () => {
    expect(reasonOf(placeFurniture(core(), 'plant', 3, 0, map))).toBe('stock');
  });

  it('床でないマスには置けない（tile）', () => {
    expect(reasonOf(placeFurniture(core({ owned: { plant: 1 } }), 'plant', 1, 1, map))).toBe('tile');
  });

  it('家具のあるマスには置けない（tile）', () => {
    expect(reasonOf(placeFurniture(core({ owned: { plant: 1 } }), 'plant', 1, 0, map))).toBe('tile');
  });

  it('機材のあるマスには置けない（tile）', () => {
    const c = core({ owned: { plant: 1 } });
    c.office.nodes = [node('u0', 'server_basic', 3, 2)];
    expect(reasonOf(placeFurniture(c, 'plant', 3, 2, map))).toBe('tile');
  });

  it('床の空いたマスに置くと、在庫が減り、家具が増える', () => {
    const out = placeFurniture(core({ owned: { plant: 1 } }), 'plant', 3, 0, map);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.core.owned.plant).toBe(0);
    expect(out.core.office.furniture.map((f) => f.uid)).toEqual(['f0', 'f1']);
    expect(out.core.office.furnitureSeq).toBe(2);
  });
});

describe('家具を撤去する', () => {
  it('机の上にPCがあると撤去できない（occupied）', () => {
    const c = core();
    c.office.nodes = [node('u0', 'pc_basic', 1, 0)];
    expect(reasonOf(removeFurniture(c, 'f0'))).toBe('occupied');
  });

  it('撤去すると在庫に戻る', () => {
    const out = removeFurniture(core(), 'f0');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.core.owned.desk).toBe(1);
    expect(out.core.office.furniture).toEqual([]);
  });
});

describe('自社オフィスにPCを置く', () => {
  it('机のないマスには置けない（desk）', () => {
    const c = core({ owned: { pc_basic: 1 } });
    expect(reasonOf(placeInOffice(c, 'pc_basic', 0, 0, map, env))).toBe('desk');
  });

  it('机の上に置ける', () => {
    const c = core({ owned: { pc_basic: 1 } });
    expect(placeInOffice(c, 'pc_basic', 1, 0, map, env).ok).toBe(true);
  });

  it('机の上にほかの機材があれば置けない（desk）', () => {
    const c = core({ owned: { pc_basic: 1 } });
    c.office.nodes = [node('u0', 'pc_basic', 1, 0)];
    expect(reasonOf(placeInOffice(c, 'pc_basic', 1, 0, map, env))).toBe('desk');
  });
});

describe('自社オフィスにPC以外の機材を置く', () => {
  it('家具のあるマスには置けない（tile）', () => {
    const c = core({ owned: { server_basic: 1 } });
    expect(reasonOf(placeInOffice(c, 'server_basic', 1, 0, map, env))).toBe('tile');
  });

  it('家具のない床のマスには置ける', () => {
    const c = core({ owned: { server_basic: 1 } });
    expect(placeInOffice(c, 'server_basic', 0, 2, map, env).ok).toBe(true);
  });
});

describe('社員を雇う', () => {
  const isSeat = (id: string) => id === 'desk';

  it('席の数を家具から数える', () => {
    const office = core().office;
    expect(seatCount(office, isSeat)).toBe(1);
  });

  const newcomer = createStaff({ job: 'infra', level: 1, salary: 200000 }, 1, 9).staff;

  it('席が足りなければ雇えない（seat）', () => {
    expect(reasonOf(hire(core(), isSeat, newcomer))).toBe('seat');
  });

  it('席が空いていれば雇える', () => {
    const out = hire(core({ staff: [], staffSeq: 0, office: { ...emptyOffice(), furniture: [{ uid: 'f0', id: 'desk', x: 1, y: 0 }, { uid: 'f1', id: 'desk', x: 2, y: 0 }], furnitureSeq: 2 } }), isSeat, newcomer);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.core.staff).toEqual([newcomer]);
    expect(out.core.staffSeq).toBe(1);
  });
});
