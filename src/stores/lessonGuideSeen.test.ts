// 教材の案内の、構成に残らない条件の記録: 同じ教材を開き直すと消え、案内が最初から始まる
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();

describe('教材の案内の記録', () => {
  beforeEach(() => st().newSandbox());

  it('記録は重ねず、教材を開き直す・閉じると消える', () => {
    st().openLesson('stp_triangle');
    st().markGuideSeen(['lesson:stp_triangle:0']);
    st().markGuideSeen(['lesson:stp_triangle:0', 'lesson:stp_triangle:1']);
    expect(st().guideSeen).toEqual(['lesson:stp_triangle:0', 'lesson:stp_triangle:1']);
    st().openLesson('stp_triangle');
    expect(st().guideSeen).toEqual([]);
    st().markGuideSeen(['lesson:stp_triangle:0']);
    st().closeLesson();
    expect(st().guideSeen).toEqual([]);
  });
});
