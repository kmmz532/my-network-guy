import { describe, expect, it } from 'vitest';
import type { Balance, GameMap } from '../data/schema';
import balanceJson from '../assets/data/balance.json';
import type { NetLink, NetNode } from '../network/types';
import { canExpand, expandCostOf, expandCountOf, expandOffice, officeMapOf, type ExpandSide } from './office';
import { emptyOffice, noEffects, type Core, type Office, type Project } from './project';

const config = (balanceJson as Balance).office;
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

const link = (uid: string, path: [number, number][]): NetLink => ({
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
  clock: { minute: 0, money, paidMonths: 0, bankrupt: false },
  reputation: 0,
  owned: {},
  completed: [],
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

  it('買うたびに1.5倍になる', () => {
    expect(expandCostOf({ w: 7, h: 5 }, config)).toBe(300000);
    expect(expandCostOf({ w: 7, h: 7 }, config)).toBe(450000);
    expect(expandCostOf({ w: 9, h: 7 }, config)).toBe(675000);
  });

  it('大きさから、広げた回数を数える（右・下・左のどの順でも同じ）', () => {
    expect(expandCountOf({ w: 9, h: 7 }, SMALL, 2)).toBe(3);
    expect(expandCountOf({ w: 14, h: 8 }, SMALL, 2)).toBe(6);
  });
});

describe('上限', () => {
  it('床 15×11 までしか広げられない', () => {
    expect(canExpand({ w: 13, h: 8 }, 'right', config)).toBe(true);
    expect(canExpand({ w: 15, h: 5 }, 'right', config)).toBe(false);
    expect(canExpand({ w: 15, h: 5 }, 'left', config)).toBe(false);
    // 5 から2マスずつ広げるため、11 が高さの上限
    expect(canExpand({ w: 5, h: 9 }, 'bottom', config)).toBe(true);
    expect(canExpand({ w: 5, h: 11 }, 'bottom', config)).toBe(false);
  });

  it('上限の辺を広げると、理由 max で失敗し、部屋と資金は変わらない', () => {
    const start = core(10_000_000, { size: { w: 15, h: 5 } });
    const r = expandOffice(start, 'right', config);
    expect(r).toEqual({ ok: false, reason: 'max' });
  });
});

describe('広げる', () => {
  it('資金が足りなければ、理由 money で失敗する', () => {
    expect(expandOffice(core(199_999), 'right', config)).toEqual({ ok: false, reason: 'money' });
  });

  it('資金がちょうどあれば買え、費用を引く', () => {
    const r = expandOffice(core(200_000), 'right', config);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.core.clock.money).toBe(0);
    expect(r.core.office.size).toEqual({ w: 7, h: 5 });
  });

  it('右に広げても、置いてあるものの座標は変わらない', () => {
    const r = expandOffice(core(1_000_000), 'right', config);
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
    const r = expandOffice(core(1_000_000), 'bottom', config);
    if (!r.ok) throw new Error('広げられるはず');
    expect(r.core.office.size).toEqual({ w: 5, h: 7 });
    expect(r.core.office.nodes.map((n) => [n.x, n.y])).toEqual([
      [2, 2],
      [4, 3],
    ]);
  });

  it('左に広げると、機器・家具・ケーブルの座標を2マスずらし、同じ見た目の位置に保つ', () => {
    const r = expandOffice(core(1_000_000), 'left', config);
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
    const r = expandOffice(core(1_000_000), 'left', config);
    if (!r.ok) throw new Error('広げられるはず');
    const map = officeMapOf(r.core.office.size);
    const floor = (x: number, y: number) => map.legend[map.tiles[y][x]] === 'floor';
    expect(r.core.office.nodes.every((n) => floor(n.x, n.y))).toBe(true);
    expect(r.core.office.furniture.every((f) => floor(f.x, f.y))).toBe(true);
  });

  it('受注中の自社案件があるときは、理由 inhouse で失敗する', () => {
    const inhouse = { contract: { inhouse: true } } as unknown as Project;
    expect(expandOffice(core(1_000_000, {}, [inhouse]), 'right', config)).toEqual({ ok: false, reason: 'inhouse' });
  });

  it('辺の種類ごとに、広げたあとの大きさを返す', () => {
    const sides: ExpandSide[] = ['right', 'bottom', 'left'];
    const sizes = sides.map((side) => {
      const r = expandOffice(core(1_000_000), side, config);
      return r.ok ? r.core.office.size : null;
    });
    expect(sizes).toEqual([
      { w: 7, h: 5 },
      { w: 5, h: 7 },
      { w: 7, h: 5 },
    ]);
  });
});
