// 演習の進行。画面・ストアに依存しない純粋関数。
// 問いは順に解く。answer（答えを選ぶ）→ 誤答の2回目で revealed（正解を出す）→ fix（直してテストする。build と diagnose だけ）→ 次の問い。最後の問いの後は done。
import type { Drill, Question } from '../data/schema';

export type DrillStage = 'answer' | 'revealed' | 'fix' | 'done';

export interface DrillRun {
  // 今の問い（0 始まり）
  index: number;
  stage: DrillStage;
  // 今の問いでの誤答の数
  misses: number;
}

// 誤答がこの回数に達したら、正解を出す
export const REVEAL_AT = 2;

// build は答えを選ばず、すぐ直す
const firstStage = (q: Question): DrillStage => (q.kind === 'build' ? 'fix' : 'answer');

export const questionOf = (drill: Pick<Drill, 'id' | 'questions'>, run: DrillRun): Question => {
  const q = drill.questions[run.index];
  if (!q) throw new Error(`演習 ${drill.id}: ${run.index} 番の問いがない`);
  return q;
};

export const startRun = (drill: Pick<Drill, 'id' | 'questions'>): DrillRun => ({ index: 0, stage: firstStage(questionOf(drill, { index: 0, stage: 'answer', misses: 0 })), misses: 0 });

// 次の問いへ（最後の後は done）
const advance = (drill: Pick<Drill, 'id' | 'questions'>, run: DrillRun): DrillRun => {
  const index = run.index + 1;
  if (index >= drill.questions.length) return { index: run.index, stage: 'done', misses: 0 };
  return { index, stage: firstStage(questionOf(drill, { ...run, index })), misses: 0 };
};

// 答えを選んだ。正解なら、直す問い（diagnose）は fix へ、それ以外は次の問いへ。誤答は数え、REVEAL_AT 回目で正解を出す
export const submit = (drill: Pick<Drill, 'id' | 'questions'>, run: DrillRun, correct: boolean): DrillRun => {
  if (run.stage !== 'answer') throw new Error(`演習 ${drill.id}: 答えを選ぶ段ではない（${run.stage}）`);
  if (correct) return questionOf(drill, run).kind === 'diagnose' ? { ...run, stage: 'fix', misses: 0 } : advance(drill, run);
  const misses = run.misses + 1;
  return { ...run, misses, stage: misses >= REVEAL_AT ? 'revealed' : 'answer' };
};

// 正解を見た後に進む。直す問い（diagnose）は fix へ、それ以外は次の問いへ
export const proceed = (drill: Pick<Drill, 'id' | 'questions'>, run: DrillRun): DrillRun => {
  if (run.stage !== 'revealed') throw new Error(`演習 ${drill.id}: 正解を出した段ではない（${run.stage}）`);
  return questionOf(drill, run).kind === 'diagnose' ? { ...run, stage: 'fix', misses: 0 } : advance(drill, run);
};

// 直した後のテストの結果。合格なら次の問いへ
export const tested = (drill: Pick<Drill, 'id' | 'questions'>, run: DrillRun, passed: boolean): DrillRun => {
  if (run.stage !== 'fix') throw new Error(`演習 ${drill.id}: 直す段ではない（${run.stage}）`);
  return passed ? advance(drill, run) : run;
};
