import { EMPTY_FAMILIARITY } from './familiar';
import { describe, expect, it } from 'vitest';
import type { Balance, GameMap } from '../data/schema';
import balanceJson from '../assets/data/balance.json';
import type { NetLink, NetNode } from '../network/types';
import {
  canExpand,
  expandActionOf,
  expandCostOf,
  expandCountOf,
  expandOffice,
  expansionLocked,
  mainSizeOf,
  mapOfOffice,
  officeExpandCostOf,
  officeMapOf,
  type ExpandSide,
} from './office';
import { emptyOffice, noEffects, type Core, type Office, type Project } from './project';

const config = (balanceJson as unknown as Balance).office;
const SMALL = { w: 5, h: 5 };

const node = (uid: string, x: number, y: number): NetNode => ({
  uid,
  device: 'pc_basic',
  x,
  y,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
});

const link = (uid: string, path: [number, number][]): NetLink => ({ paid: 0,
  uid,
  cable: 'utp_cat5e',
  a: { node: 'a', port: 0 },
  b: { node: 'b', port: 0 },
  path,
});

const office = (over: Partial<Office> = {}): Office => ({
  ...emptyOffice(SMALL),
  nodes: [node('a', 2, 2), node('b', 4, 3)],
  links: [link('l0', [
    [2, 2],
    [2, 3],
    [4, 3],
  ])],
  furniture: [{ uid: 'f0', id: 'desk', x: 3, y: 3 }],
  furnitureSeq: 1,
  seq: 2,
  ...over,
});

const core = (money: number, over: Partial<Office> = {}, active: Project[] = []): Core => ({
  clock: { minute: 0, money, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: 0,
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
  offers: [],
  active,
  focus: null,
  office: office(over),
  effects: noEffects(),
  staff: [],
  staffSeq: 0,
  candidates: [],
  guidesDone: [],
});

describe('部屋のマップ', () => {
  it('5×5の床は、奥の壁に窓を1組、手前と左右に壁を置く', () => {
    const map = officeMapOf(SMALL);
    expect(map.width).toBe(7);
    expect(map.height).toBe(7);
    expect(map.tiles).toEqual(['#WW####', '#.....#', '#.....#', '#.....#', '#.....#', '#.....#', '#######']);
  });

  it('14×8の床は、移行前の固定のマップ（hq）と同じ並びになる', () => {
    const map = officeMapOf({ w: 14, h: 8 });
    expect(map.tiles[0]).toBe('#WW########WW###');
    expect(map.tiles.slice(1, 9).every((row) => row === '#' + '.'.repeat(14) + '#')).toBe(true);
    expect(map.tiles[9]).toBe('#'.repeat(16));
  });

  it('床の大きさがマップの大きさになる（壁の分だけ大きい）', () => {
    const map: GameMap = officeMapOf({ w: 9, h: 7 });
    expect(map.tiles).toHaveLength(map.height);
    expect(map.tiles.every((row) => row.length === map.width)).toBe(true);
    expect(map.id).toBe('hq');
  });
});

describe('費用', () => {
  it('新しく始めた部屋の費用は 200,000円', () => {
    expect(expandCountOf(SMALL, config.initialSize, config.expand.step)).toBe(0);
    expect(expandCostOf(SMALL, config)).toBe(200000);
  });

  it('買うたびに 60,000円ずつ増える（直線）', () => {
    expect(expandCostOf({ w: 7, h: 5 }, config)).toBe(260000);
    expect(expandCostOf({ w: 7, h: 7 }, config)).toBe(320000);
    expect(expandCostOf({ w: 9, h: 7 }, config)).toBe(380000);
  });

  it('上限の大きさの費用は、増え続けず 800,000円に収まる', () => {
    expect(expandCostOf({ w: 15, h: 15 }, config)).toBe(800000);
  });

  it('大きさから、広げた回数を数える（右・下・左のどの順でも同じ）', () => {
    expect(expandCountOf({ w: 9, h: 7 }, SMALL, 2)).toBe(3);
    expect(expandCountOf({ w: 14, h: 8 }, SMALL, 2)).toBe(6);
  });
});

describe('上限', () => {
  it('床 15×15 までしか広げられない', () => {
    expect(canExpand({ w: 13, h: 8 }, 'right', config)).toBe(true);
    expect(canExpand({ w: 15, h: 5 }, 'right', config)).toBe(false);
    expect(canExpand({ w: 15, h: 5 }, 'left', config)).toBe(false);
    // 5 から2マスずつ広げるため、13 から 15 へ広がる
    expect(canExpand({ w: 5, h: 13 }, 'bottom', config)).toBe(true);
    expect(canExpand({ w: 5, h: 15 }, 'bottom', config)).toBe(false);
  });

  it('上限に達していない辺は、広げる操作になる', () => {
    expect(expandActionOf(office(), 'right', config)).toBe('expand');
  });

  it('上限に達した辺は、別室を足す操作になる', () => {
    expect(expandActionOf(office({ size: { w: 15, h: 5 } }), 'right', config)).toBe('annex');
  });
});

describe('広げる', () => {
  it('資金が足りなければ、理由 money で失敗する', () => {
    expect(expandOffice(core(199_999), 'right', config, 999)).toEqual({ ok: false, reason: 'money' });
  });

  it('資金がちょうどあれば買え、費用を引く', () => {
    const r = expandOffice(core(200_000), 'right', config, 999);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.core.clock.money).toBe(0);
    expect(r.core.office.size).toEqual({ w: 7, h: 5 });
  });

  it('右に広げても、置いてあるものの座標は変わらない', () => {
    const r = expandOffice(core(1_000_000), 'right', config, 999);
    if (!r.ok) throw new Error('広げられるはず');
    expect(r.core.office.nodes.map((n) => [n.x, n.y])).toEqual([
      [2, 2],
      [4, 3],
    ]);
    expect(r.core.office.furniture.map((f) => [f.x, f.y])).toEqual([[3, 3]]);
    expect(r.core.office.links[0].path).toEqual([
      [2, 2],
      [2, 3],
      [4, 3],
    ]);
  });

  it('下に広げると、高さだけが増える', () => {
    const r = expandOffice(core(1_000_000), 'bottom', config, 999);
    if (!r.ok) throw new Error('広げられるはず');
    expect(r.core.office.size).toEqual({ w: 5, h: 7 });
    expect(r.core.office.nodes.map((n) => [n.x, n.y])).toEqual([
      [2, 2],
      [4, 3],
    ]);
  });

  it('左に広げると、機器・家具・ケーブルの座標を2マスずらし、同じ見た目の位置に保つ', () => {
    const r = expandOffice(core(1_000_000), 'left', config, 999);
    if (!r.ok) throw new Error('広げられるはず');
    expect(r.core.office.size).toEqual({ w: 7, h: 5 });
    expect(r.core.office.nodes.map((n) => [n.uid, n.x, n.y])).toEqual([
      ['a', 4, 2],
      ['b', 6, 3],
    ]);
    expect(r.core.office.furniture.map((f) => [f.uid, f.x, f.y])).toEqual([['f0', 5, 3]]);
    expect(r.core.office.links[0].path).toEqual([
      [4, 2],
      [4, 3],
      [6, 3],
    ]);
  });

  it('左に広げたあとも、ずらした座標は新しい部屋のマップの床の中にある', () => {
    const r = expandOffice(core(1_000_000), 'left', config, 999);
    if (!r.ok) throw new Error('広げられるはず');
    const map = officeMapOf(r.core.office.size);
    const floor = (x: number, y: number) => map.legend[map.tiles[y][x]] === 'floor';
    expect(r.core.office.nodes.every((n) => floor(n.x, n.y))).toBe(true);
    expect(r.core.office.furniture.every((f) => floor(f.x, f.y))).toBe(true);
  });

  it('受注中の自社案件があるときは、理由 inhouse で失敗する', () => {
    const inhouse = { contract: { inhouse: true } } as unknown as Project;
    expect(expandOffice(core(1_000_000, {}, [inhouse]), 'right', config, 999)).toEqual({ ok: false, reason: 'inhouse' });
  });

  it('辺の種類ごとに、広げたあとの大きさを返す', () => {
    const sides: ExpandSide[] = ['right', 'bottom', 'left'];
    const sizes = sides.map((side) => {
      const r = expandOffice(core(1_000_000), side, config, 999);
      return r.ok ? r.core.office.size : null;
    });
    expect(sizes).toEqual([
      { w: 7, h: 5 },
      { w: 5, h: 7 },
      { w: 7, h: 5 },
    ]);
  });
});

describe('別室', () => {
  const at15 = (over: Partial<Office> = {}) => core(10_000_000, { size: { w: 15, h: 5 }, ...over });
  const ok = (r: ReturnType<typeof expandOffice>) => {
    if (!r.ok) throw new Error(`失敗: ${r.reason}`);
    return r.core.office;
  };

  it('右の辺が上限なら、仕切りの壁1マスと奥行き5マスの床を足す（床の大きさは 21×5）', () => {
    const o = ok(expandOffice(at15(), 'right', config, 999));
    expect(o.size).toEqual({ w: 21, h: 5 });
    expect(o.annexes).toEqual(['right']);
    // 仕切りは外壁だった列（x=16）の、床の高さ分（y=1〜5）。中央（y=3）はドア
    expect(o.doors).toEqual([{ x: 16, y: 3 }]);
    expect(o.innerWalls).toEqual([
      { x: 16, y: 1 },
      { x: 16, y: 2 },
      { x: 16, y: 4 },
      { x: 16, y: 5 },
    ]);
  });

  it('別室のマップは、仕切りの壁とドアを含み、別室の床は通れる', () => {
    const o = ok(expandOffice(at15(), 'right', config, 999));
    const map = mapOfOffice(o);
    expect(map.width).toBe(23);
    expect(map.tiles[1][16]).toBe('#');
    expect(map.tiles[3][16]).toBe('D');
    expect(map.legend[map.tiles[3][16]]).toBe('door');
    expect(map.legend[map.tiles[3][20]]).toBe('floor');
    expect(map.legend[map.tiles[0][22]]).toBe('wall');
  });

  it('下の辺が上限なら、下に別室を足す（横の長さは床の幅と同じ）', () => {
    const start = core(10_000_000, { size: { w: 5, h: 15 } });
    const o = ok(expandOffice(start, 'bottom', config, 999));
    expect(o.size).toEqual({ w: 5, h: 21 });
    expect(o.doors).toEqual([{ x: 3, y: 16 }]);
    expect(o.innerWalls).toHaveLength(4);
    expect(o.innerWalls.every((c) => c.y === 16)).toBe(true);
  });

  it('同じ辺に2つ目の別室は足せず、理由 max で失敗する', () => {
    const once = ok(expandOffice(at15(), 'right', config, 999));
    expect(expandOffice({ ...core(10_000_000), office: once }, 'right', config, 999)).toEqual({ ok: false, reason: 'max' });
  });

  it('別室のある辺は、床を広げる操作もできない', () => {
    const once = ok(expandOffice(at15(), 'right', config, 999));
    expect(expandActionOf(once, 'right', config)).toBeNull();
  });

  it('別室の床は広げられず、本体の大きさで上限を見る', () => {
    const once = ok(expandOffice(at15(), 'right', config, 999));
    expect(mainSizeOf(once)).toEqual({ w: 15, h: 5 });
    // 本体は左も上限のままなので、左は別室を足す操作になる
    expect(expandActionOf(once, 'left', config)).toBe('annex');
    expect(expandActionOf(once, 'bottom', config)).toBe('expand');
  });

  it('費用は本体の大きさで決まり、通常の拡張と同じ式で続く', () => {
    expect(officeExpandCostOf(at15().office, config)).toBe(expandCostOf({ w: 15, h: 5 }, config));
    const once = ok(expandOffice(at15(), 'right', config, 999));
    expect(officeExpandCostOf(once, config)).toBe(expandCostOf({ w: 15, h: 5 }, config));
  });

  it('資金が足りなければ、別室は理由 money で失敗する', () => {
    const start = core(100, { size: { w: 15, h: 5 } });
    expect(expandOffice(start, 'right', config, 999)).toEqual({ ok: false, reason: 'money' });
  });

  it('左に別室を足すと、機器・家具・ケーブル・内側の壁・ドアを右へ6マスずらす', () => {
    const withParts = office({
      size: { w: 15, h: 5 },
      innerWalls: [{ x: 6, y: 1 }],
      doors: [{ x: 6, y: 3 }],
    });
    const o = ok(expandOffice({ ...core(10_000_000), office: withParts }, 'left', config, 999));
    expect(o.size).toEqual({ w: 21, h: 5 });
    expect(o.nodes.map((n) => [n.x, n.y])).toEqual([
      [8, 2],
      [10, 3],
    ]);
    expect(o.furniture.map((f) => [f.x, f.y])).toEqual([[9, 3]]);
    expect(o.links[0].path[0]).toEqual([8, 2]);
    // 既存の内側の壁・ドアは右へ6マス。新しい仕切りは、ずらしたあとの左の外壁の次の列（x=6）
    expect(o.innerWalls).toContainEqual({ x: 12, y: 1 });
    expect(o.innerWalls).toContainEqual({ x: 6, y: 1 });
    expect(o.doors).toContainEqual({ x: 12, y: 3 });
    expect(o.doors).toContainEqual({ x: 6, y: 3 });
    expect(o.annexes).toEqual(['left']);
  });

  it('左に別室を足したあとも、ずらした座標は床の中にある', () => {
    const o = ok(expandOffice({ ...core(10_000_000), office: office({ size: { w: 15, h: 5 } }) }, 'left', config, 999));
    const map = mapOfOffice(o);
    const floor = (x: number, y: number) => map.legend[map.tiles[y][x]] === 'floor';
    expect(o.nodes.every((n) => floor(n.x, n.y))).toBe(true);
    expect(o.furniture.every((f) => floor(f.x, f.y))).toBe(true);
  });

  it('内側の壁・ドアのマスは、マップの壁・ドアとして反映する', () => {
    const map = officeMapOf({ w: 5, h: 5 }, [{ x: 3, y: 2 }], [{ x: 3, y: 4 }]);
    expect(map.tiles[2][3]).toBe('#');
    expect(map.tiles[4][3]).toBe('D');
    expect(map.tiles[3][3]).toBe('.');
  });
});

describe('別室の仕切りの壁を延ばす', () => {
  const rich = (over: Partial<Office> = {}) => core(1_000_000_000, { size: { w: 15, h: 5 }, ...over });
  const ok = (r: ReturnType<typeof expandOffice>) => {
    if (!r.ok) throw new Error(`失敗: ${r.reason}`);
    return r.core;
  };
  const grow = (c: Core, side: ExpandSide, times: number): Core => {
    let cur = c;
    for (let i = 0; i < times; i++) cur = ok(expandOffice(cur, side, config, 999));
    return cur;
  };
  // ドア（通れる床）を通らずに、from から届くマス
  const reachWithoutDoors = (map: GameMap, from: [number, number]): Set<string> => {
    const seen = new Set<string>([`${from[0]},${from[1]}`]);
    const queue: [number, number][] = [from];
    while (queue.length) {
      const [x, y] = queue.shift()!;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (map.legend[map.tiles[ny]?.[nx]] !== 'floor') continue;
        const key = `${nx},${ny}`;
        if (seen.has(key)) continue;
        seen.add(key);
        queue.push([nx, ny]);
      }
    }
    return seen;
  };

  it('右の別室のあとに下へ広げると、仕切りの壁は新しい床の分だけ延び、ドアは動かない', () => {
    const c = grow(rich(), 'right', 1);
    const next = grow(c, 'bottom', 2);
    expect(next.office.size).toEqual({ w: 21, h: 9 });
    expect(next.office.doors).toEqual([{ x: 16, y: 3 }]);
    const ys = next.office.innerWalls.filter((w) => w.x === 16).map((w) => w.y).sort((a, b) => a - b);
    expect(ys).toEqual([1, 2, 4, 5, 6, 7, 8, 9]);
    // 本体と別室は、ドアを除いてつながらない（新しい行の床も含む）
    const map = mapOfOffice(next.office);
    const fromMain = reachWithoutDoors(map, [2, 2]);
    expect(fromMain.has('18,2')).toBe(false);
    expect(fromMain.has('18,8')).toBe(false);
  });

  it('左の別室のあとに下へ広げると、左の仕切りの壁も延びる（ドアは動かない）', () => {
    const c = grow(rich(), 'left', 1);
    const next = grow(c, 'bottom', 1);
    expect(next.office.doors).toEqual([{ x: 6, y: 3 }]);
    const ys = next.office.innerWalls.filter((w) => w.x === 6).map((w) => w.y).sort((a, b) => a - b);
    expect(ys).toEqual([1, 2, 4, 5, 6, 7]);
  });

  it('右の別室のあとに、下の別室を足しても、右の別室と本体は下の別室とつながらない', () => {
    const c = grow(grow(rich(), 'right', 1), 'bottom', 5);
    expect(c.office.size.h).toBe(15);
    const next = ok(expandOffice(c, 'bottom', config, 999));
    const office = next.office;
    expect(office.annexes).toEqual(['right', 'bottom']);
    expect(office.size).toEqual({ w: 21, h: 21 });
    expect(office.doors).toEqual([
      { x: 16, y: 3 },
      { x: 11, y: 16 },
    ]);
    const map = mapOfOffice(office);
    const fromMain = reachWithoutDoors(map, [2, 2]);
    // 右の別室（ドアを通らない）と、下の別室（ドアを通らない）は本体から届かない
    expect(fromMain.has('18,2')).toBe(false);
    expect(fromMain.has('2,18')).toBe(false);
    // 右の別室の床と、下の別室の床は、角で通じない
    expect(fromMain.has('18,18')).toBe(false);
    expect(map.legend[map.tiles[16][18]]).toBe('wall');
    // 下の別室の仕切りは、床の幅いっぱい（右の別室の下まで）
    expect(map.legend[map.tiles[16][21]]).toBe('wall');
  });

  it('下の別室のあとに左右へ広げると、下の別室の仕切りも延びる（ドアは動かない）', () => {
    const c = grow(rich({ size: { w: 5, h: 15 } }), 'bottom', 1);
    expect(c.office.annexes).toEqual(['bottom']);
    const next = grow(c, 'right', 2);
    expect(next.office.size).toEqual({ w: 9, h: 21 });
    expect(next.office.doors).toEqual([{ x: 3, y: 16 }]);
    const xs = next.office.innerWalls.filter((w) => w.y === 16).map((w) => w.x).sort((a, b) => a - b);
    expect(xs).toEqual([1, 2, 4, 5, 6, 7, 8, 9]);
  });
});


describe('拡張の解放のレベル（N45）', () => {
  it('次の拡張の解放のレベルに届かないと拡張できない', () => {
    // 1回目の拡張は Lv3 から
    const start = { size: { w: 5, h: 5 }, innerWalls: [], doors: [], annexes: [], nodes: [], links: [], seq: 0, furniture: [], furnitureSeq: 0 } as never;
    expect(expandOffice({ ...core(1_000_000), office: start }, 'right', config, 2)).toEqual({ ok: false, reason: 'level' });
    expect(expandOffice({ ...core(1_000_000), office: start }, 'right', config, 3).ok).toBe(true);
  });
});

describe('expansionLocked（次の拡張が会社のレベルで解放されていないか。N59）', () => {
  const need0 = config.expand.unlockLevels[0];
  it('レベルが届かないあいだは解放されていない（ボタンを出さない）', () => {
    const office = emptyOffice(SMALL);
    expect(expansionLocked(office, config, need0 - 1)).toBe(true);
  });
  it('レベルが届けば解放される', () => {
    const office = emptyOffice(SMALL);
    expect(expansionLocked(office, config, need0)).toBe(false);
  });
  it('拡張の回数の上限のあとは、解放の判定の対象がない（false）', () => {
    const office = emptyOffice(SMALL);
    const done = config.expand.unlockLevels.length;
    const many = { ...office, annexes: Array.from({ length: done }, (_, i) => (['left', 'right', 'bottom'] as const)[i % 3]) };
    expect(expansionLocked(many, config, 0)).toBe(false);
  });
});
