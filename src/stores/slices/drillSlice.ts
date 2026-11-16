// 演習（学習モード）の進行。問いの判定は sim/drill、段の遷移は sim/drillRun。ここは今の構成（office）を渡して結果を状態に載せる。保存しない
import type { StateCreator } from 'zustand';
import type { QuestionSet } from '../../data/schema';
import { analyze } from '../../network/engine/analyze';
import type { FailureReason } from '../../network/types';
import { diagnoseAnswer, diagnoseReasonChoices, diagnoseReaches, inspectAnswer, inspectChoices, judgeDiagnose, judgeInspect } from '../../sim/drill';
import { proceed, questionOf, startRun, submit, tested, type DrillRun } from '../../sim/drillRun';
import { gameEnv } from '../../sim/env';
import { lessonEntryOf } from '../../sim/lessonCatalog';
import { sandboxTest } from '../../sim/sandbox';
import { type LearnRecord, achieveLesson, finishDrill, loadLearn, recordAnswer, saveLearn } from '../../settings/learn';
import { lessonCatalog } from '../lessonCatalog';
import { createOps } from '../gameOps';
import type { GameState } from '../useGameStore';

// 問いに入ったときに構成から求めた候補
export interface DrillView {
  // 調べる問いの候補
  choices: string[];
  // 原因の問いの候補（機器と理由）
  nodes: string[];
  reasons: FailureReason[];
}

// 出した正解。調べる問いは文字列、原因の問いは機器と理由
export type DrillAnswer = string | { node: string; reason: FailureReason };

export interface DrillSlice {
  sandboxDrill: DrillRun | null;
  drillView: DrillView | null;
  drillAnswer: DrillAnswer | null;
  // 教材の発展の問いを閉じた（教材を開き直すまで出さない）
  followUpsClosed: boolean;
  // 正しく答えた発展の問いの id（教材を開いている間だけ持つ）
  lessonAnswers: string[];
  // 構成を変えたため、今の構成では正解を求められない
  drillBroken: boolean;
  // 学習の記録（端末ごと。セーブに入れない）
  learn: LearnRecord;
  // 教材の達成を記録する
  achieveLesson: (id: string) => void;
  beginDrill: (drill: QuestionSet) => void;
  // 教材の発展の問いを始める（達成した後に一度だけ。すでに始めた、閉じた、発展の問いがない教材では何もしない）
  beginFollowUps: () => void;
  closeFollowUps: () => void;
  answerInspect: (choice: string) => void;
  answerDiagnose: (node: string, reason: FailureReason) => void;
  proceedDrill: () => void;
  testDrill: () => void;
}

export const createDrillSlice: StateCreator<GameState, [], [], DrillSlice> = (set, get) => {
  const { applyUnrecorded } = createOps(set, get);
  const updateLearn = (f: (rec: LearnRecord) => LearnRecord): void => {
    const learn = f(get().learn);
    saveLearn(learn);
    set({ learn });
  };
  // 今の問いの組。演習はその演習、教材は発展の問い
  const drillOf = (): QuestionSet => {
    const id = get().sandboxLesson?.id;
    if (id === undefined) throw new Error('演習を開いていない');
    const entry = lessonEntryOf(lessonCatalog, id);
    const questions = entry.drill ?? entry.followUps;
    if (!questions) throw new Error(`${id} は演習でも、発展の問いのある教材でもない`);
    return questions;
  };
  // 教材の発展の問いに正しく答えた
  const markAnswered = (id: string): void => {
    if (get().sandboxLesson !== null && !get().lessonAnswers.includes(id)) set({ lessonAnswers: [...get().lessonAnswers, id] });
  };
  const runOf = (): DrillRun => {
    const run = get().sandboxDrill;
    if (!run) throw new Error('演習の進行がない');
    return run;
  };
  const stateOf = () => {
    const { office } = get();
    return analyze({ nodes: office.nodes, links: office.links, plans: office.plans }, gameEnv.engine);
  };

  // 進行を next にする。問い（from の番号）が変わるときは、その問いの前の設定を構成に当て、候補を求める
  const move = (drill: QuestionSet, next: DrillRun, from: number): void => {
    // 最後まで解いた記録は演習だけ（教材の発展の問いは任意）
    if (next.stage === 'done' && lessonEntryOf(lessonCatalog, drill.id).drill) updateLearn((rec) => finishDrill(rec, drill.id));
    if (next.stage === 'done' || next.index === from) {
      set({ sandboxDrill: next, drillAnswer: null, drillBroken: false, ...(next.stage === 'done' ? { drillView: null } : {}) });
      return;
    }
    const q = questionOf(drill, next);
    // 設定の変更は、機器の設定の操作と同じ通り道で当てる（履歴には積まない）
    for (const c of (drill.setup ?? []).filter((x) => x.before === q.id).flatMap((x) => x.change)) {
      const reason = applyUnrecorded(c);
      if (reason !== null) throw new Error(`演習 ${drill.id}: 問い ${q.id} の前の設定の変更に失敗した（${c.uid} ${c.change.kind}: ${reason}）`);
    }
    set({ check: null, traces: [] });
    const state = stateOf();
    const view: DrillView = { choices: [], nodes: [], reasons: [] };
    if (q.kind === 'inspect') view.choices = inspectChoices(state, q.ask);
    if (q.kind === 'diagnose') {
      view.nodes = state.net.nodes.map((n) => n.uid);
      view.reasons = diagnoseReasonChoices(state, q);
    }
    set({ sandboxDrill: next, drillView: view, drillAnswer: null, drillBroken: false });
  };

  return {
    sandboxDrill: null,
    learn: loadLearn(),
    achieveLesson: (id) => updateLearn((rec) => achieveLesson(rec, id)),
    drillView: null,
    drillAnswer: null,
    followUpsClosed: false,
    lessonAnswers: [],
    drillBroken: false,
    beginFollowUps: () => {
      const { sandboxLesson, sandboxDrill, followUpsClosed } = get();
      if (sandboxLesson === null || sandboxDrill !== null || followUpsClosed) return;
      const followUps = lessonEntryOf(lessonCatalog, sandboxLesson.id).followUps;
      if (followUps) get().beginDrill(followUps);
    },
    closeFollowUps: () => set({ followUpsClosed: true }),
    beginDrill: (drill) => {
      const run = startRun(drill);
      // 最初の問いの前の設定は、開いた構成に当てる
      move(drill, run, -1);
    },
    answerInspect: (choice) => {
      const drill = drillOf();
      const run = runOf();
      const q = questionOf(drill, run);
      if (q.kind !== 'inspect') throw new Error(`問い ${q.id} は調べる問いではない`);
      const state = stateOf();
      // 構成を変えて、正解を求められなくなったときだけ止める
      let correct: boolean;
      let next: DrillRun;
      let answer: DrillAnswer | null = null;
      try {
        correct = judgeInspect(state, q.ask, choice);
        next = submit(drill, run, correct);
        if (next.stage === 'revealed') answer = inspectAnswer(state, q.ask);
      } catch {
        set({ drillBroken: true });
        return;
      }
      updateLearn((rec) => recordAnswer(rec, drill.id, q.id, correct));
      if (correct) markAnswered(q.id);
      move(drill, next, run.index);
      set({ drillAnswer: answer });
    },
    answerDiagnose: (node, reason) => {
      const drill = drillOf();
      const run = runOf();
      const q = questionOf(drill, run);
      if (q.kind !== 'diagnose') throw new Error(`問い ${q.id} は原因を選ぶ問いではない`);
      const state = stateOf();
      // すでに直して届くなら、原因を選ばせずに次へ進む
      if (diagnoseReaches(state, q)) {
        move(drill, tested(drill, submit(drill, run, true), true), run.index);
        return;
      }
      const correct = judgeDiagnose(state, q, { node, reason });
      updateLearn((rec) => recordAnswer(rec, drill.id, q.id, correct));
      if (correct) markAnswered(q.id);
      const next = submit(drill, run, correct);
      move(drill, next, run.index);
      set({ drillAnswer: next.stage === 'revealed' ? diagnoseAnswer(state, q) : null });
    },
    proceedDrill: () => {
      const drill = drillOf();
      const run = runOf();
      move(drill, proceed(drill, run), run.index);
    },
    testDrill: () => {
      const drill = drillOf();
      const run = runOf();
      if (run.stage !== 'fix') return;
      const q = questionOf(drill, run);
      let passed: boolean;
      if (q.kind === 'build') {
        const sr = sandboxTest(get().office, gameEnv, q.goals);
        if (!sr) throw new Error(`問い ${q.id}: 判定できる達成条件がない`);
        set({ lastError: null, traces: sr.traces, check: { projectId: 'hq', goals: sr.goals, warnings: sr.warnings }, helpUid: null });
        passed = sr.passed;
      } else if (q.kind === 'diagnose') {
        passed = diagnoseReaches(stateOf(), q);
        set({ lastError: null, traces: [], check: { projectId: 'hq', goals: [{ ok: passed, failures: [] }], warnings: [] }, helpUid: null });
      } else {
        throw new Error(`問い ${q.id} は直す問いではない`);
      }
      move(drill, tested(drill, run, passed), run.index);
    },
  };
};
