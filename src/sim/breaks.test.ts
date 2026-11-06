// 社員の休憩の予定（N42）。1回30分以上・1日3回まで・合計2時間まで・勤務時間の中・同じ日は同じ予定
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { breakAt, breakPlanOf } from './breaks';

const balance = balanceJson as unknown as Balance;

describe('休憩の予定', () => {
  it('どの社員・どの日も、回数・長さ・合計・時刻の決まりを守る', () => {
    const cfg = balance.breaks;
    for (const uid of ['s0', 's1', 's2', 'c5_1', 'c9_0']) {
      for (let day = 0; day < 60; day++) {
        const plan = breakPlanOf(uid, day, balance);
        expect(plan.length).toBeLessThanOrEqual(cfg.maxPerDay);
        expect(plan.reduce((sum, b) => sum + b.length, 0)).toBeLessThanOrEqual(cfg.maxMinutesPerDay);
        let previousEnd = -1;
        for (const b of plan) {
          expect(b.length).toBeGreaterThanOrEqual(cfg.minMinutes);
          expect(b.length).toBeLessThanOrEqual(cfg.maxMinutes);
          expect(b.start).toBeGreaterThanOrEqual(balance.build.workStartHour * 60);
          expect(b.start + b.length).toBeLessThanOrEqual(balance.build.workEndHour * 60);
          expect(b.start).toBeGreaterThanOrEqual(previousEnd);
          previousEnd = b.start + b.length;
        }
      }
    }
  });

  it('同じ社員・同じ日なら、何度計算しても同じ予定になる', () => {
    expect(breakPlanOf('s0', 3, balance)).toEqual(breakPlanOf('s0', 3, balance));
  });

  it('休憩の時刻の判定', () => {
    const plan = [{ start: 600, length: 30 }];
    expect(breakAt(600, plan)).toEqual({ start: 600, length: 30 });
    expect(breakAt(629, plan)).not.toBeNull();
    expect(breakAt(630, plan)).toBeNull();
  });
});
