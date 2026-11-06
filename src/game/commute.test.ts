import { describe, expect, it } from 'vitest';
import { bfsRoute, commuteStep, STEP_MS, type Commute } from './commute';

// 床が全部歩けるマス（幅 6 × 高さ 3）。x=0 の列はドア、x=5 の列は壁
const passable = (x: number, y: number) => x >= 0 && x <= 4 && y >= 0 && y <= 2;
const route = (from: { x: number; y: number }, to: { x: number; y: number }) => bfsRoute(from, to, passable);
const desk = { x: 3, y: 1 };
const door = { x: 0, y: 1 };

describe('bfsRoute', () => {
  it('壁を避けて最短で行く', () => {
    const path = bfsRoute({ x: 1, y: 0 }, { x: 1, y: 2 }, passable);
    expect(path).toEqual([
      { x: 1, y: 1 },
      { x: 1, y: 2 },
    ]);
  });

  it('行けなければ null', () => {
    expect(bfsRoute({ x: 0, y: 0 }, { x: 9, y: 9 }, passable)).toBeNull();
  });
});

describe('commuteStep', () => {
  it('終業で机からドアへ歩き、着いたら外にいる（描かない）', () => {
    let c: Commute = { state: 'seated', at: desk, path: [] };
    c = commuteStep(c, 0, false, desk, door, route);
    expect(c.state).toBe('out');
    // 3マス（横に3）歩くには 3 × STEP_MS かかる
    c = commuteStep(c, STEP_MS * 2, false, desk, door, route);
    expect(c.state).toBe('out');
    c = commuteStep(c, STEP_MS * 2, false, desk, door, route);
    expect(c.state).toBe('away');
  });

  it('始業になると、ドアから机へ歩いて入り、座る', () => {
    let c: Commute = { state: 'away', at: door, path: [] };
    c = commuteStep(c, 0, true, desk, door, route);
    expect(c.state).toBe('in');
    c = commuteStep(c, STEP_MS * 10, true, desk, door, route);
    expect(c.state).toBe('seated');
    expect(c.at).toEqual(desk);
  });

  it('夜間は、机に座っている社員もすぐに外へ出る流れになり、外にいる社員は戻らない', () => {
    const away: Commute = { state: 'away', at: door, path: [] };
    expect(commuteStep(away, STEP_MS * 5, false, desk, door, route).state).toBe('away');
  });

  it('歩いている途中で時間帯が変わっても、着くまでは状態を変えない', () => {
    let c: Commute = { state: 'out', at: desk, path: [{ x: 2, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 1 }] };
    c = commuteStep(c, STEP_MS, true, desk, door, route);
    expect(c.state).toBe('out');
  });
});
