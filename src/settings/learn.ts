// 学習の記録（端末ごと）。セーブデータとは別に localStorage へ保存する。教材は達成したか、演習は問いごとの正答・誤答の回数と最後まで解いたか。
// 読めないときや壊れているときは、端末の設定と同じく空の記録で動く（開発中は理由を出す）。

export interface QuestionRecord {
  right: number;
  wrong: number;
  // 最初の答えが正解だったか
  first: boolean;
}

export interface DrillRecord {
  questions: Record<string, QuestionRecord>;
  // 最後まで解いたか
  done: boolean;
}

export interface LearnRecord {
  // 達成した教材の ID
  lessons: string[];
  drills: Record<string, DrillRecord>;
}

export const LEARN_KEY = 'network-ya.learn.v1';

export const emptyLearn = (): LearnRecord => ({ lessons: [], drills: {} });

// 教材を達成した
export const achieveLesson = (rec: LearnRecord, id: string): LearnRecord =>
  rec.lessons.includes(id) ? rec : { ...rec, lessons: [...rec.lessons, id] };

const drillOf = (rec: LearnRecord, id: string): DrillRecord => rec.drills[id] ?? { questions: {}, done: false };

// 問いに答えた（正答か誤答かを数える。最初の答えだけ first に残す）
export const recordAnswer = (rec: LearnRecord, drillId: string, questionId: string, correct: boolean): LearnRecord => {
  const d = drillOf(rec, drillId);
  const q = d.questions[questionId];
  const next: QuestionRecord = q
    ? { ...q, right: q.right + (correct ? 1 : 0), wrong: q.wrong + (correct ? 0 : 1) }
    : { right: correct ? 1 : 0, wrong: correct ? 0 : 1, first: correct };
  return { ...rec, drills: { ...rec.drills, [drillId]: { ...d, questions: { ...d.questions, [questionId]: next } } } };
};

// 演習を最後まで解いた
export const finishDrill = (rec: LearnRecord, drillId: string): LearnRecord => ({
  ...rec,
  drills: { ...rec.drills, [drillId]: { ...drillOf(rec, drillId), done: true } },
});

// 演習の正答率（0 から 1）。答えた問いのうち、最初の答えが正解だった問いの割合。答えた問いがなければ null
export const accuracyOf = (rec: LearnRecord, drillIds: string[]): number | null => {
  const qs = drillIds.flatMap((id) => Object.values(rec.drills[id]?.questions ?? {}));
  if (qs.length === 0) return null;
  return qs.filter((q) => q.first).length / qs.length;
};

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;

// 保存された文字列を読む。壊れた値は空の記録にし、壊れた項目だけを捨てる
export function parseLearn(raw: string | null): LearnRecord {
  if (!raw) return emptyLearn();
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    if (import.meta.env.DEV) console.warn('端末の学習の記録が読めないため、空の記録にする', e);
    return emptyLearn();
  }
  if (typeof data !== 'object' || data === null) return emptyLearn();
  const d = data as Record<string, unknown>;
  const lessons = Array.isArray(d.lessons) ? d.lessons.filter((x): x is string => typeof x === 'string') : [];
  const drills: Record<string, DrillRecord> = {};
  if (typeof d.drills === 'object' && d.drills !== null) {
    for (const [id, v] of Object.entries(d.drills)) {
      if (typeof v !== 'object' || v === null) continue;
      const dr = v as Record<string, unknown>;
      const questions: Record<string, QuestionRecord> = {};
      if (typeof dr.questions === 'object' && dr.questions !== null) {
        for (const [qid, qv] of Object.entries(dr.questions)) {
          const q = qv as Record<string, unknown> | null;
          if (typeof q === 'object' && q !== null && isCount(q.right) && isCount(q.wrong) && typeof q.first === 'boolean') {
            questions[qid] = { right: q.right, wrong: q.wrong, first: q.first };
          }
        }
      }
      drills[id] = { questions, done: dr.done === true };
    }
  }
  return { lessons, drills };
}

// 読み込み。localStorage が使えないときは空の記録
export function loadLearn(): LearnRecord {
  try {
    return parseLearn(window.localStorage.getItem(LEARN_KEY));
  } catch {
    return emptyLearn();
  }
}

// 保存。保存できなくても、この画面を開いている間は記録が残る
export function saveLearn(rec: LearnRecord): void {
  try {
    window.localStorage.setItem(LEARN_KEY, JSON.stringify(rec));
  } catch {
    // 保存できない端末では、この画面を開いている間だけ有効
  }
}
