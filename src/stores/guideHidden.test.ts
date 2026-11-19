// 案内をしまう: しまっても終えた扱いにならず、しまった状態はセーブを通って残る。最後の手順まで進むと終えた扱いになる
import { beforeEach, describe, expect, it } from 'vitest';
import { exportSave, importSave } from '../services/saveFile';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();
const C = 'c001_direct_link';

describe('案内をしまう', () => {
  beforeEach(() => st().newSandbox());

  it('しまっても guidesDone には入らず、戻すと外れる', () => {
    st().setGuideHidden(C, true);
    expect(st().guidesHidden).toEqual([C]);
    expect(st().guidesDone).toEqual([]);
    st().setGuideHidden(C, true);
    expect(st().guidesHidden).toEqual([C]);
    st().setGuideHidden(C, false);
    expect(st().guidesHidden).toEqual([]);
  });

  it('最後の手順まで進んで案内を終えると、guidesDone に入る', () => {
    st().setGuideHidden(C, true);
    st().markGuideDone(C);
    expect(st().guidesDone).toEqual([C]);
  });

  it('しまった状態は、書き出して読み込んでも残る', () => {
    st().setGuideHidden(C, true);
    st().setGuideHidden('lesson:stp_triangle', true);
    st().load(importSave(exportSave(st().snapshot())));
    expect(st().guidesHidden).toEqual([C, 'lesson:stp_triangle']);
    expect(st().guidesDone).toEqual([]);
  });

  it('教材を開き直すと、その教材のしまった状態は戻る', () => {
    st().setGuideHidden('lesson:stp_triangle', true);
    st().setGuideHidden(C, true);
    st().openLesson('stp_triangle');
    expect(st().guidesHidden).toEqual([C]);
  });
});
