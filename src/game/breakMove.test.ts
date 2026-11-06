// 休憩の動き（N42）。机 → 休憩の場所 → 机の流れ。行けない場所では机にいる
import { describe, expect, it } from 'vitest';
import { STEP_MS } from './commute';
import { breakMoveStep, deskMove, type BreakMove } from './breakMove';

const desk = { x: 2, y: 3 };
const spot = { x: 5, y: 3 };
// 横に進んでから縦に進む（テスト用の単純な経路。行けないことはない）
const route = (from: { x: number; y: number }, to: { x: number; y: number }) => {
  const out: { x: number; y: number }[] = [];
  let x = from.x;
  let y = from.y;
  while (x !== to.x) out.push({ x: (x += Math.sign(to.x - x)), y });
  while (y !== to.y) out.push({ x, y: (y += Math.sign(to.y - y)) });
  return out;
};

const run = (m: BreakMove, steps: number, onBreak: boolean, dt = STEP_MS): BreakMove => {
  let cur = m;
  for (let i = 0; i < steps; i++) cur = breakMoveStep(cur, dt, onBreak, desk, spot, route);
  return cur;
};

describe('休憩の動き', () => {
  it('休憩が始まると机から休憩の場所へ歩き、着いたら使う', () => {
    let m: BreakMove = deskMove(desk);
    m = breakMoveStep(m, 0, true, desk, spot, route);
    expect(m.phase).toBe('going');
    m = run(m, 3, true);
    expect(m.phase).toBe('resting');
    expect(m.at).toEqual(spot);
  });

  it('休憩が終わると、休憩の場所から机へ戻り、机に着く', () => {
    const resting: BreakMove = { phase: 'resting', at: { ...spot }, path: [] };
    let m = breakMoveStep(resting, 0, false, desk, spot, route);
    expect(m.phase).toBe('returning');
    m = run(m, 5, false);
    expect(m.phase).toBe('desk');
    expect(m.at).toEqual(desk);
  });

  it('行けない場所のときは、机にいる', () => {
    const none = () => null;
    const m = breakMoveStep(deskMove(desk), 0, true, desk, spot, none);
    expect(m.phase).toBe('desk');
  });
});
