import { EMPTY_FAMILIARITY } from './familiar';
import { describe, expect, it } from 'vitest';
import type { GameMap } from '../data/schema';
import type { NetNode } from '../network/types';
import { furnitureBonus, hire, placeFurniture, removeFurniture, seatCount, type BonusEnv } from './furniture';
import balanceJson from '../assets/data/balance.json';
import furnitureJson from '../assets/data/furniture.json';
import type { Balance, Furniture } from '../data/schema';
import { createStaff } from './staff';
import { emptyOffice, noEffects, placeInOffice, type Core, type Env } from './project';

// 1行目は床・2行目の(1,1)は壁。机は(1,0)に置いておく
const map = {
  id: 'test',
  width: 4,
  height: 3,
  tileSize: 32,
  floor: 'wood',
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
  companyExp: 0,
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  offers: [],
  active: [],
  focus: null,
  office: { ...emptyOffice({ w: 5, h: 5 }), furniture: [{ uid: 'f0', id: 'desk', x: 1, y: 0 }], furnitureSeq: 1 },
  effects: noEffects(),
  staff: [createStaff({ job: 'network', level: 1, salary: 200000 }, 1, 0).staff],
  staffSeq: 1,
  candidates: [],
  guidesDone: [],
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

  const candidate = { ...createStaff({ job: 'infra', level: 1, salary: 200000 }, 1, 9).staff, uid: 'c1_0' };
  const twoDesks = { ...emptyOffice({ w: 5, h: 5 }), furniture: [{ uid: 'f0', id: 'desk', x: 1, y: 0 }, { uid: 'f1', id: 'desk', x: 2, y: 0 }], furnitureSeq: 2 };

  it('席が足りなければ採用できない（seat）', () => {
    expect(reasonOf(hire(core({ candidates: [candidate] }), 'c1_0', isSeat, 10, 'day'))).toBe('seat');
  });

  it('席が空いていれば採用でき、候補から社員に移る', () => {
    const out = hire(core({ staff: [], staffSeq: 0, office: twoDesks, candidates: [candidate] }), 'c1_0', isSeat, 10, 'day');
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.core.staff.map((s) => [s.uid, s.job])).toEqual([['s0', 'infra']]);
    expect(out.core.staffSeq).toBe(1);
    expect(out.core.candidates).toEqual([]);
  });

  it('候補にいない uid は採用できない（none）', () => {
    expect(reasonOf(hire(core({ staff: [], office: twoDesks }), 'nobody', isSeat, 10, 'day'))).toBe('none');
  });
});

describe('家具の補正', () => {
  const defs = Object.fromEntries(furnitureJson.furniture.map((f) => [f.id, f as unknown as Furniture]));
  const env: BonusEnv = { defs, balance: balanceJson as unknown as Balance, staffUids: ['s0'] };
  const withFurniture = (items: { id: string; x: number; y: number }[]) => ({
    ...emptyOffice({ w: 5, h: 5 }),
    furniture: [{ uid: 'desk', id: 'desk', x: 5, y: 5 }, ...items.map((f, i) => ({ uid: `f${i}`, ...f }))],
    furnitureSeq: items.length + 1,
  });

  it('範囲内の植物が2つあっても、施工力は +0.1 だけ', () => {
    const office = withFurniture([
      { id: 'plant', x: 7, y: 5 },
      { id: 'plant', x: 5, y: 7 },
    ]);
    expect(furnitureBonus(office, 's0', env).power).toBeCloseTo(0.1);
  });

  it('範囲外（机から3マス以上）の植物は効かない', () => {
    expect(furnitureBonus(withFurniture([{ id: 'plant', x: 8, y: 5 }]), 's0', env).power).toBe(0);
  });

  it('植物とコーヒーの施工力は足し合わせる（+0.15）', () => {
    const office = withFurniture([
      { id: 'plant', x: 7, y: 5 },
      { id: 'coffee', x: 0, y: 0 },
    ]);
    expect(furnitureBonus(office, 's0', env).power).toBeCloseTo(0.15);
  });

  it('席のない社員には、施工力も経験値も効かない', () => {
    const office = withFurniture([
      { id: 'plant', x: 7, y: 5 },
      { id: 'bookshelf', x: 5, y: 7 },
    ]);
    expect(furnitureBonus(office, 'nobody', env)).toEqual({ power: 0, exp: 0, seatless: 0.5 });
  });

  it('ソファがあれば、席のない社員の係数は 0.7 になる', () => {
    expect(furnitureBonus(withFurniture([{ id: 'sofa', x: 0, y: 0 }]), 'nobody', env).seatless).toBe(0.7);
  });
});
