import { beforeEach, describe, expect, it } from 'vitest';
import { accuracyOf, achieveLesson, emptyLearn, finishDrill, LEARN_KEY, loadLearn, parseLearn, recordAnswer, saveLearn } from './learn';

describe('学習の記録', () => {
  it('教材を達成すると記録に入り、2回達成しても1つだけ', () => {
    const rec = achieveLesson(achieveLesson(emptyLearn(), 'l1'), 'l1');
    expect(rec.lessons).toEqual(['l1']);
  });

  it('誤答と正答を数え、最初の答えだけを first に残す', () => {
    let rec = recordAnswer(emptyLearn(), 'd', 'a', false);
    rec = recordAnswer(rec, 'd', 'a', false);
    rec = recordAnswer(rec, 'd', 'b', true);
    expect(rec.drills.d.questions.a).toEqual({ right: 0, wrong: 2, first: false });
    expect(rec.drills.d.questions.b).toEqual({ right: 1, wrong: 0, first: true });
    expect(finishDrill(rec, 'd').drills.d.done).toBe(true);
  });

  it('正答率は、最初で正解した問いの割合。答えた問いがなければ null', () => {
    let rec = recordAnswer(emptyLearn(), 'd1', 'a', true);
    rec = recordAnswer(rec, 'd1', 'b', false);
    rec = recordAnswer(rec, 'd2', 'a', true);
    rec = recordAnswer(rec, 'd2', 'c', true);
    expect(accuracyOf(rec, ['d1'])).toBe(0.5);
    expect(accuracyOf(rec, ['d1', 'd2'])).toBe(0.75);
    expect(accuracyOf(rec, ['d3'])).toBeNull();
  });

  it('壊れた記録は空の記録、壊れた項目だけを捨てる', () => {
    expect(parseLearn('{not json')).toEqual(emptyLearn());
    expect(parseLearn('7')).toEqual(emptyLearn());
    const rec = parseLearn(JSON.stringify({ lessons: ['x', 3], drills: { d: { done: true, questions: { a: { right: 1, wrong: 0, first: true }, b: { right: -1 } } } } }));
    expect(rec).toEqual({ lessons: ['x'], drills: { d: { done: true, questions: { a: { right: 1, wrong: 0, first: true } } } } });
  });

  describe('保存と読み込み', () => {
    beforeEach(() => {
      const store = new Map<string, string>();
      (globalThis as { window?: unknown }).window = {
        localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) },
      };
    });
    it('保存した記録を読み戻せる', () => {
      const rec = finishDrill(recordAnswer(achieveLesson(emptyLearn(), 'l1'), 'd', 'a', false), 'd');
      saveLearn(rec);
      expect(window.localStorage.getItem(LEARN_KEY)).not.toBeNull();
      expect(loadLearn()).toEqual(rec);
    });
  });
});
