// エンディング: 最後の山場を初めて納品した結果の後に1回だけ流れ、終わると元の速さに戻る。会社の歩みは、記録とセーブから求める
import { beforeEach, describe, expect, it } from 'vitest';
import { balance } from 'virtual:game-data';
import type { Staff } from '../data/schema';
import { minutesPerMonth } from '../sim/clock';
import { endingFactsOf, FINAL_CONTRACT_ID, nextEndingPhase, type EndingPhase } from '../sim/ending';
import type { Report } from '../sim/project';
import { withDeliveryRecords } from './gameHelpers';
import { useGameStore } from './useGameStore';

const finalReport: Report = { passed: true, traces: [], failures: [], stars: 3, money: 2550000, source: { kind: 'fixed', baseId: FINAL_CONTRACT_ID } };
const deliver = (r: Report) => useGameStore.setState(withDeliveryRecords(useGameStore.getState(), { lastReport: r }));

beforeEach(() => {
  useGameStore.setState({ clearedAt: null, ending: null, speed: 4, lastReport: null, records: { threeStars: 0, biggest: null } });
});

describe('エンディングが出る回数', () => {
  it('最後の山場を初めて納品すると始まり、終わると元の速さに戻る', () => {
    deliver(finalReport);
    expect(useGameStore.getState().ending).toBe('pending');
    useGameStore.getState().startEnding();
    expect(useGameStore.getState()).toMatchObject({ ending: 'playing', speed: 0, endingSpeed: 4 });
    useGameStore.getState().finishEnding();
    expect(useGameStore.getState()).toMatchObject({ ending: null, speed: 4 });
  });

  it('クリアの後は、最後の山場をもう一度納品しても始まらない', () => {
    deliver(finalReport);
    useGameStore.getState().startEnding();
    useGameStore.getState().finishEnding();
    deliver(finalReport);
    expect(useGameStore.getState().ending).toBeNull();
  });

  it('ほかの依頼の納品では始まらない', () => {
    deliver({ ...finalReport, source: { kind: 'fixed', baseId: 'b004_ibgp_two_routers' } });
    expect(useGameStore.getState().ending).toBeNull();
  });

  it('始めていない（pending でない）ときは、始める操作は何もしない', () => {
    useGameStore.getState().startEnding();
    expect(useGameStore.getState()).toMatchObject({ ending: null, speed: 4 });
  });
});

describe('会社の歩み', () => {
  const member = (uid: string, hiredMonth: number): Staff => ({ uid, name: `staff.name.${uid}`, hiredMonth }) as unknown as Staff;
  it('創業からの年とか月、最も長く勤めた社員の勤続の月数を求める', () => {
    const facts = endingFactsOf(
      { clearedAt: (14 * minutesPerMonth(balance)) + 100, deliveries: 80, records: { threeStars: 30, biggest: { kind: 'fixed', baseId: FINAL_CONTRACT_ID, money: 1 } }, staff: [member('a', 6), member('b', 2), member('c', 10)] },
      balance,
    );
    expect(facts).toMatchObject({ years: 1, months: 2, deliveries: 80, threeStars: 30, staffCount: 3, longest: { name: 'staff.name.b', months: 12 } });
  });

  it('クリアしていなければ求められない', () => {
    expect(() => endingFactsOf({ clearedAt: null, deliveries: 0, records: { threeStars: 0, biggest: null }, staff: [] }, balance)).toThrow();
  });
});

describe('エンディングの流れ', () => {
  it('集まる → 札 → スタッフロール → 最後の言葉の順に進み、最後の言葉の次はない', () => {
    const kinds: string[] = [];
    let p: EndingPhase | null = { kind: 'gather' };
    while (p !== null) {
      kinds.push(p.kind);
      p = nextEndingPhase(p, 2);
    }
    expect(kinds).toEqual(['gather', 'card', 'card', 'credits', 'credits', 'credits', 'last']);
  });
});
