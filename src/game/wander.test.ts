import { describe, expect, it } from 'vitest';
import { routeFrom, wanderStep, type Walker } from './wander';

const idle = (x: number, y: number): Walker => ({ x, y, path: [], pause: 0 });

describe('経路', () => {
  it('横に進んでから縦に進む', () => {
    expect(routeFrom({ x: 0, y: 0 }, { x: 2, y: 1 })).toEqual([
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
    ]);
  });

  it('同じマスなら経路はない', () => {
    expect(routeFrom({ x: 3, y: 3 }, { x: 3, y: 3 })).toEqual([]);
  });
});

describe('歩行', () => {
  it('1秒に1マス進む', () => {
    const w: Walker = { x: 0, y: 0, path: [{ x: 1, y: 0 }, { x: 2, y: 0 }], pause: 0 };
    const out = wanderStep(w, 1000, [], () => 0);
    expect(out.x).toBe(1);
    expect(out.y).toBe(0);
    expect(out.path).toEqual([{ x: 2, y: 0 }]);
  });

  it('途中の時間では、マスの途中にいる', () => {
    const w: Walker = { x: 0, y: 0, path: [{ x: 1, y: 0 }], pause: 0 };
    const out = wanderStep(w, 500, [], () => 0);
    expect(out.x).toBeCloseTo(0.5);
    expect(out.y).toBe(0);
  });

  it('目的地に着いたら2〜4秒止まる', () => {
    const w: Walker = { x: 0, y: 0, path: [{ x: 1, y: 0 }], pause: 0 };
    const out = wanderStep(w, 1000, [], () => 0);
    expect(out.pause).toBe(2000);
    const late = wanderStep({ ...w, path: [{ x: 1, y: 0 }] }, 1000, [], () => 0.999999);
    expect(late.pause).toBeGreaterThan(3900);
  });

  it('止まっている間は、時間が減る', () => {
    const out = wanderStep({ x: 2, y: 2, path: [], pause: 2000 }, 500, [{ x: 0, y: 0 }], () => 0);
    expect(out.pause).toBe(1500);
    expect(out.x).toBe(2);
  });

  it('止まり終わると、歩ける床のマスから次の目的地を選ぶ', () => {
    // 床は (0,2) だけ。(0,0) から2マス進んで着き、止まる
    const out = wanderStep(idle(0, 0), 3000, [{ x: 0, y: 2 }], () => 0);
    expect(out.x).toBe(0);
    expect(out.y).toBe(2);
    expect(out.pause).toBe(2000);
  });

  it('歩ける床がなければ動かない', () => {
    const w = idle(1, 1);
    expect(wanderStep(w, 1000, [], () => 0)).toEqual(w);
  });
});
