// 教材の発展の問い: 達成の前は出ず、達成の後に出る。正答で案内の条件が満たされ、答えなくても達成は変わらない
import { beforeEach, describe, expect, it } from 'vitest';
import { solutions } from '../__golden__/solutions';
import { guideStepDone, type GuideState } from '../sim/guide';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();
const solve = (id: string): void => {
  const office = st().office;
  useGameStore.setState({ office: { ...office, nodes: solutions[id](office.nodes) } });
};
const answerCondition = (): boolean => {
  const state = { answers: st().lessonAnswers } as GuideState;
  return guideStepDone({ key: 'k', target: 'test', done: 'answer:f1' }, state);
};

describe('教材の発展の問い', () => {
  beforeEach(() => st().newSandbox());

  it('達成の前は出ず、達成の後に出る。答えなくても、達成の記録は変わらない', () => {
    st().openLesson('stp_triangle');
    expect(st().sandboxDrill).toBeNull();
    // 達成の前のテスト（不合格）では出ない
    st().test();
    expect(st().sandboxDrill).toBeNull();
    expect(st().learn.lessons).not.toContain('stp_triangle');
    solve('stp_triangle');
    st().test();
    expect(st().learn.lessons).toContain('stp_triangle');
    expect(st().sandboxDrill?.stage).toBe('answer');
    // 閉じても達成は残り、同じ教材でもう一度テストしても出し直さない
    st().closeFollowUps();
    st().test();
    expect(st().followUpsClosed).toBe(true);
    expect(st().learn.lessons).toContain('stp_triangle');
    expect(answerCondition()).toBe(false);
  });

  it('正しく答えると answer の条件が満たされ、誤答では満たされない（stp_triangle）', () => {
    st().openLesson('stp_triangle');
    solve('stp_triangle');
    st().test();
    st().answerInspect('SW2');
    expect(answerCondition()).toBe(false);
    st().answerInspect('SW1');
    expect(answerCondition()).toBe(true);
    expect(st().sandboxDrill?.stage).toBe('done');
  });

  it('OSPF の3拠点: 達成の後に、コストを上げた構成で次のホップを問う', () => {
    st().openLesson('ospf_three_sites');
    solve('ospf_three_sites');
    st().test();
    const run = st().sandboxDrill;
    expect(run?.stage).toBe('answer');
    expect(st().drillView?.choices).toContain('10.0.12.2');
    st().answerInspect('10.0.12.2');
    expect(st().lessonAnswers).toContain('f1');
  });
});
