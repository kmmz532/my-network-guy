// 納品の記録: ★3の数と最も大きな案件を数え、最後の山場を初めて納品したときだけクリアの時刻を残す
import { beforeEach, describe, expect, it } from 'vitest';
import { FINAL_CONTRACT_ID } from '../sim/ending';
import type { Report } from '../sim/project';
import { withDeliveryRecords } from './gameHelpers';
import { useGameStore } from './useGameStore';

const report = (baseId: string, stars: 1 | 2 | 3, money: number, kind: 'fixed' | 'template' = 'fixed'): Report => ({ passed: true, traces: [], failures: [], stars, money, source: { kind, baseId } });
const deliver = (r: Report) => {
  const s = useGameStore.getState();
  useGameStore.setState(withDeliveryRecords(s, { lastReport: r, clock: { ...s.clock, minute: 123456 } }));
};

beforeEach(() => {
  useGameStore.setState({ clearedAt: null, records: { threeStars: 0, biggest: null }, lastReport: null });
});

describe('納品の記録', () => {
  it('★3の数と、報酬が最も大きかった案件を数える', () => {
    deliver(report('a', 3, 1000));
    deliver(report('b', 2, 5000, 'template'));
    deliver(report('c', 3, 3000));
    expect(useGameStore.getState().records).toEqual({ threeStars: 2, biggest: { kind: 'template', baseId: 'b', money: 5000 } });
  });

  it('最後の山場を初めて納品したときだけ、クリアの時刻を残す', () => {
    deliver(report('a', 3, 1000));
    expect(useGameStore.getState().clearedAt).toBeNull();
    deliver(report(FINAL_CONTRACT_ID, 1, 2000000));
    expect(useGameStore.getState().clearedAt).toBe(123456);
    useGameStore.setState({ clock: { ...useGameStore.getState().clock, minute: 999999 } });
    deliver(report(FINAL_CONTRACT_ID, 3, 2000000));
    expect(useGameStore.getState().clearedAt).toBe(123456);
  });

  it('不合格の報告は数えない', () => {
    deliver({ passed: false, traces: [], failures: [] });
    expect(useGameStore.getState().records.threeStars).toBe(0);
  });
});
