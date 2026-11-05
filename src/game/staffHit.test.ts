import { describe, expect, it } from 'vitest';
import { STAFF_H, STAFF_W, deskStaffPos, deskTap, staffAt, wanderStaffPos, type StaffHit } from './staffHit';

const TS = 32;

describe('席の社員の位置と当たり判定', () => {
  it('席の社員は机のマスの1マス下に、スプライトの幅の中央で描く', () => {
    expect(deskStaffPos(2, 3, TS, 0)).toEqual({ x: 2 * TS + (TS - STAFF_W) / 2, y: 4 * TS - 6 });
    expect(deskStaffPos(2, 3, TS, 1).y).toBe(4 * TS - 7);
  });

  it('揺れは席ごとに、2コマで1周期ずらす', () => {
    expect(deskTap(0, 0)).toBe(0);
    expect(deskTap(0, 1)).toBe(1);
    expect(deskTap(300, 0)).toBe(1);
    expect(deskTap(300, 1)).toBe(0);
  });

  it('スプライトの範囲の中では社員を返し、机のマスの上（スプライトの外）では null', () => {
    const at = deskStaffPos(2, 3, TS, 0);
    const hits: StaffHit[] = [{ uid: 's0', ...at }];
    expect(staffAt(hits, { x: at.x, y: at.y })).toBe('s0');
    expect(staffAt(hits, { x: at.x + STAFF_W - 1, y: at.y + STAFF_H - 1 })).toBe('s0');
    // 右端・下端の外
    expect(staffAt(hits, { x: at.x + STAFF_W, y: at.y })).toBeNull();
    expect(staffAt(hits, { x: at.x, y: at.y + STAFF_H })).toBeNull();
    // 机のマス（1マス上）は社員ではない
    expect(staffAt(hits, { x: 2 * TS + 16, y: 3 * TS + 16 })).toBeNull();
  });
});

describe('歩き回る社員の当たり判定', () => {
  it('今いる位置（小数のマス）で判定する', () => {
    const at = wanderStaffPos(5.5, 6.25, TS);
    const hits: StaffHit[] = [{ uid: 's4', ...at }];
    expect(staffAt(hits, { x: at.x + 1, y: at.y + 1 })).toBe('s4');
    expect(staffAt(hits, { x: 5 * TS, y: 6 * TS })).toBeNull();
  });

  it('複数の社員のうち、押した位置にいる社員を返す', () => {
    const a = deskStaffPos(0, 0, TS, 0);
    const b = wanderStaffPos(4, 4, TS);
    const hits: StaffHit[] = [
      { uid: 's0', ...a },
      { uid: 's2', ...b },
    ];
    expect(staffAt(hits, { x: b.x + 2, y: b.y + 2 })).toBe('s2');
    expect(staffAt([], { x: 0, y: 0 })).toBeNull();
  });
});
