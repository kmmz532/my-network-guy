// 案内を最初から出し直す: 終えた・しまった記録と、その案件の手順の記録だけを外す（ほかの案件の記録は残す）
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();
const C = 'c001_direct_link';
const D = 'c002_small_office';

describe('案内を最初から見る', () => {
  beforeEach(() => st().newSandbox());

  it('終えた・しまった記録と、その案件の手順の記録を外し、ほかの案件は残す', () => {
    st().markGuideDone(C);
    st().markGuideDone(D);
    st().setGuideHidden(C, true);
    st().markGuideSeen([`${C}:0`, `${D}:0`]);
    st().restartGuide(C);
    expect(st().guidesDone).toEqual([D]);
    expect(st().guidesHidden).toEqual([]);
    expect(st().guideSeen).toEqual([`${D}:0`]);
  });
});
