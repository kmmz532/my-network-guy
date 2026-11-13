import { EMPTY_FAMILIARITY } from './familiar';
import { describe, expect, it } from 'vitest';
import type { GameMap } from '../data/schema';
import { assignDesks, freeDesks, furnitureBonus, hire, moveFurniture, placeFurniture, removeFurniture, rotateFurniture, seatedStaff, type BonusEnv } from './furniture';
import type { NetNode } from '../network/types';
import balanceJson from '../assets/data/balance.json';
import furnitureJson from '../assets/data/furniture.json';
import type { Balance, Furniture } from '../data/schema';
import { createStaff } from './staff';
import { emptyOffice, noEffects, type Core, type Env, type Office } from './project';
import { placeInOffice } from './placement';

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

const node = (uid: string, device: string, x: number, y: number): NetNode => ({ ports: [],
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
  clock: { minute: 0, money: 1000000, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
  offers: [],
  active: [],
  focus: null,
  office: { ...emptyOffice({ w: 5, h: 5 }), furniture: [{ uid: 'f0', id: 'desk', x: 1, y: 0 }], furnitureSeq: 1 },
  effects: noEffects(),
  staff: [createStaff({ job: 'network', level: 1, salary: 200000 }, 1, 0).staff],
  staffSeq: 1,
  candidates: [],
  guidesDone: [],
  termsShown: [],
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

  it('空いている席（机）を家具から数える', () => {
    const office = core().office;
    expect(freeDesks(office, [], isSeat).length).toBe(1);
    expect(freeDesks(office, [{ desk: office.furniture[0].uid }], isSeat).length).toBe(0);
  });

  const candidate = { ...createStaff({ job: 'infra', level: 1, salary: 200000 }, 1, 9).staff, uid: 'c1_0' };
  const twoDesks = { ...emptyOffice({ w: 5, h: 5 }), furniture: [{ uid: 'f0', id: 'desk', x: 1, y: 0 }, { uid: 'f1', id: 'desk', x: 2, y: 0 }], furnitureSeq: 2 };

  it('空いている机がなければ採用できない（seat）', () => {
    // 机に座っている社員がいる（その机は空いていない）
    const seated = { ...candidate, uid: 's0', desk: core().office.furniture[0].uid };
    expect(reasonOf(hire(core({ candidates: [candidate], staff: [seated] }), 'c1_0', isSeat, 10, 'day'))).toBe('seat');
  });

  it('採用した社員は、空いている机に座る', () => {
    const out = hire(core({ staff: [], staffSeq: 0, office: twoDesks, candidates: [candidate] }), 'c1_0', isSeat, 10, 'day');
    expect(out.ok && out.core.staff[0].desk).toBe('f0');
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
  const env: BonusEnv = { defs, balance: balanceJson as unknown as Balance, staff: [{ uid: 's0', desk: 'desk' }], pcDesks: [] };
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

describe('社員ごとの机（A: 辞めた社員の机は空いたままにする）', () => {
  const isSeat = (id: string) => id === 'desk';
  const office = { ...emptyOffice({ w: 5, h: 5 }), furniture: [{ uid: 'f0', id: 'desk', x: 1, y: 0 }, { uid: 'f1', id: 'desk', x: 2, y: 0 }], furnitureSeq: 2 };
  const seat = (uid: string, desk: string | null) => ({ ...createStaff({ job: 'infra', level: 1, salary: 1 }, 1, 0).staff, uid, desk });

  it('社員が辞めても、ほかの社員は同じ机に座り続ける', () => {
    const staff = [seat('s0', 'f0'), seat('s1', 'f1')];
    const remaining = staff.filter((s) => s.uid !== 's0');
    expect(seatedStaff(office, remaining, isSeat).map((x) => [x.member.uid, x.desk.uid])).toEqual([['s1', 'f1']]);
  });

  it('辞めた社員の机は空き、次の採用はその机に座る', () => {
    const remaining = [seat('s1', 'f1')];
    expect(freeDesks(office, remaining, isSeat).map((f) => f.uid)).toEqual(['f0']);
  });

  it('座っている机は撤去できない（seated）', () => {
    const core = { office, staff: [seat('s0', 'f0')], active: [] } as unknown as Core;
    expect(removeFurniture(core, 'f0')).toEqual({ ok: false, reason: 'seated' });
  });

  it('机のない社員は、空いている机を並び順に割り当てる（ゲームの開始・移行）', () => {
    const assigned = assignDesks([seat('s0', null), seat('s1', null), seat('s2', null)], office, isSeat);
    expect(assigned.map((s) => s.desk)).toEqual(['f0', 'f1', null]);
  });
});

describe('座っている机の移動（N103）', () => {
  // 床だけの地図（7×5）と、(2,2) の机の上の PC
  const map = { id: 'hq', width: 7, height: 5, tileSize: 32, floor: 'wood', legend: { '.': 'floor' }, tiles: ['.......', '.......', '.......', '.......', '.......'] } as unknown as GameMap;
  const desk = { uid: 'd0', id: 'desk', x: 2, y: 2 };
  const pc = { uid: 'n0', device: 'pc_basic', x: 2, y: 2 } as unknown as NetNode;
  const other = { uid: 'n1', device: 'pc_basic', x: 5, y: 4 } as unknown as NetNode;
  const link = (uid: string, a: string, b: string, path: [number, number][]) => ({ uid, cable: 'utp', a: { node: a, port: 0 }, b: { node: b, port: 0 }, path, paid: 0 });
  const withOffice = (over: Partial<Office>) => ({ ...core().office, furniture: [desk], furnitureSeq: 1, nodes: [] as NetNode[], links: [], ...over }) as Office;

  it('机の上の PC は、机と一緒に動く', () => {
    const out = moveFurniture({ ...core(), office: withOffice({ nodes: [pc] }) }, 'd0', 3, 2, map);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.core.office.furniture[0]).toMatchObject({ x: 3, y: 2 });
    expect(out.core.office.nodes[0]).toMatchObject({ x: 3, y: 2 });
  });

  it('机につながるケーブルは、動いた機器から、もう一方の機器まで道筋を引き直す', () => {
    const office = withOffice({ nodes: [pc, { ...other, x: 2, y: 3 }], links: [link('l0', 'n0', 'n1', [[2, 2], [2, 3]])] });
    const out = moveFurniture({ ...core(), office } as Core, 'd0', 4, 2, map);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const path = out.core.office.links[0].path;
    expect(path[0]).toEqual([4, 2]);
    expect(path[path.length - 1]).toEqual([2, 3]);
  });

  it('道筋が引けなければ、机は動かせない（tile）', () => {
    // もう一方の機器（1,1）は、四方を家具で囲まれている（道がない）
    const fence = [{ uid: 'f1', id: 'plant', x: 0, y: 1 }, { uid: 'f2', id: 'plant', x: 2, y: 1 }, { uid: 'f3', id: 'plant', x: 1, y: 0 }, { uid: 'f4', id: 'plant', x: 1, y: 2 }];
    const office = withOffice({ furniture: [desk, ...fence], furnitureSeq: 5, nodes: [pc, { ...other, x: 1, y: 1 }], links: [link('l0', 'n0', 'n1', [[2, 2], [1, 2], [1, 1]])] });
    expect(reasonOf(moveFurniture({ ...core(), office } as Core, 'd0', 4, 2, map))).toBe('tile');
  });
});

describe('家具を回す（N95）', () => {
  it('家具の向きが90度ずつ変わる（上 → 右 → 手前 → 左）', () => {
    const c0 = { ...core(), office: { ...core().office, furniture: [{ uid: 'd0', id: 'desk', x: 1, y: 1 }], furnitureSeq: 1 } } as Core;
    const once = rotateFurniture(c0, 'd0');
    expect(once.ok && once.core.office.furniture[0].facing).toBe('right');
    const twice = once.ok ? rotateFurniture(once.core, 'd0') : null;
    expect(twice?.ok && twice.core.office.furniture[0].facing).toBe('down');
  });

  it('ない家具は回せない（none）', () => {
    expect(reasonOf(rotateFurniture(core(), 'nope'))).toBe('none');
  });
});
