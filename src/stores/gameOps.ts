// 案件の操作の結果を状態に反映する仕組み（apply）と、設計の操作の履歴（recorded・取り消し・やり直し）。スライスが共通で使う。
import { loadSettings } from '../settings/settings';
import { gameEnv } from '../sim/env';

import { autoAssign } from '../sim/autoAssign';
import { emptyHistory, entryOf, historyKeyOf, projectHistoryKey, push as pushHistory, redo as redoHistory, stepDesign, undo as undoHistory } from '../sim/history';
import { writeBackDhcp, type NetTarget, type Outcome } from '../sim/project';
import { requestBuild } from '../sim/progress';
import { applyOperation } from '../company/apply';
import type { Operation } from '../company/operation';

import { plannedKey, type PlannedNet, coreOf, focusedProject, opContextOf, reportState, withLevelUps } from './gameHelpers';
import type { GameState } from './useGameStore';
import { useUiStore } from './useUiStore';
import type { StoreApi } from 'zustand';

type Set = StoreApi<GameState>['setState'];

export const createOps = (set: Set, get: () => GameState) => {
  // 配線・セグメントの設定の後に、IPアドレスの自動割り当てをかける（設定がオフなら何もしない）。同じ操作として取り消しに残る
  // 詳しくで選んだネットワークを、そのセグメントのポートから探す
  const plannedOf = (seg: { members: { node: string; port: number }[] }): PlannedNet | undefined => {
    for (const m of seg.members) {
      const p = get().planned[plannedKey(m.node, m.port)];
      if (p) return p;
    }
    return undefined;
  };
  const withAutoIp = (o: Outcome, target: NetTarget): Outcome =>
    o.ok ? { ...o, core: autoAssign(o.core, gameEnv, target, loadSettings().autoIp, plannedOf) } : o;

  // 案件の操作の結果を状態に反映する。失敗なら理由を返す
  // 機器の位置（失敗の吹き出しを出す場所）
  const tileOf = (uid: string) => {
    const n = focusedProject(get())?.nodes.find((x) => x.uid === uid) ?? get().office.nodes.find((x) => x.uid === uid);
    return n ? { tx: n.x, ty: n.y } : undefined;
  };

  // 設計の操作を履歴に積む。操作の前後の状態から、資金・在庫・費用の差分を取って積む。操作が成功したときだけ積む
  const recorded = (run: () => string | null): string | null => {
    const key = historyKeyOf(focusedProject(get()));
    const before = coreOf(get());
    const reason = run();
    if (reason === null) {
      const entry = entryOf(before, coreOf(get()));
      set((s) => ({
        histories: { ...s.histories, [key]: pushHistory(s.histories[key] ?? emptyHistory(), entry) },
        historyError: null,
      }));
    }
    return reason;
  };

  // 履歴を消す（施工の依頼・取り消し・自社案件の受注）
  const dropHistory = (key: string) =>
    set((s) => ({ histories: Object.fromEntries(Object.entries(s.histories).filter(([k]) => k !== key)) }));

  // 元に戻す・やり直す。いまの設計の対象の履歴を1つ動かし、差分を反映する。資金か在庫が足りなければ戻さず、理由を残す
  const stepHistory = (dir: 'undo' | 'redo') => {
    const s = get();
    const core = coreOf(s);
    const key = historyKeyOf(focusedProject(s));
    const h = s.histories[key];
    if (!h) return;
    const r = dir === 'undo' ? undoHistory(h) : redoHistory(h);
    if (!r) return;
    const res = stepDesign(core, r.entry, dir);
    if (!res.ok) {
      if (res.reason === dir) set({ historyError: dir });
      return;
    }
    const next = res.core;
    // テストの結果と、選んでいる途中の配線・ポップアップは、戻した設計では無効になる
    set({
      clock: next.clock,
      owned: next.owned,
      active: next.active,
      office: next.office,
      histories: { ...s.histories, [key]: r.history },
      historyError: null,
      check: null,
      helpUid: null,
      lastError: null,
    });
    useUiStore.setState({ wireStart: null, portMenu: null });
  };

  const apply = (outcome: Outcome, at?: { tx: number; ty: number }): string | null => {
    if (!outcome.ok) {
      const flash = at ? { key: `ui.error.${outcome.reason}`, ...at, at: Date.now() } : null;
      set({ lastError: outcome.reason });
      if (flash) useUiStore.setState({ flash });
      return outcome.reason;
    }
    // 自動（DHCP）の口の受け取ったアドレスを、機器へ書き戻す
    const c = writeBackDhcp(outcome.core, { ...gameEnv, mapOf: (id) => get().maps[id] });
    // サンドボックスは資金を減らさない（費用は差し引かない）。床の機器・配線を変えたら、テストの結果は無効になる
    const sandbox = get().mode === 'sandbox';
    // 設計（機器・配線・セグメント）を変えたら、最後のテストの結果は無効になる
    const before = focusedProject(get());
    const after = focusedProject(c);
    const redesigned =
      before !== null &&
      after !== null &&
      before.id === after.id &&
      (before.nodes !== after.nodes || before.links !== after.links || before.plans !== after.plans);
    set(withLevelUps(get(), {
      lastError: null,
      ...(redesigned || (sandbox && c.office !== get().office) ? { check: null, helpUid: null } : {}),
      clock: sandbox ? get().clock : c.clock,
      companyExp: c.companyExp,
      reputation: c.reputation,
      owned: c.owned,
      completed: c.completed,
      deliveries: c.deliveries,
      familiarity: c.familiarity,
      offers: c.offers,
      active: c.active,
      focus: c.focus,
      office: c.office,
      effects: c.effects,
      staff: c.staff,
      staffSeq: c.staffSeq,
      candidates: c.candidates,
      ...reportState(outcome.report),
    }));
    return null;
  };

  // 操作1つを世界に当て、状態に反映して履歴に積む。画面の操作の通り道はここだけにする。失敗なら理由を返す
  // at は失敗の吹き出しを出すマス。autoIp を渡すと、成功した操作の後に IPアドレスの自動割り当てを同じ操作としてかける
  const dispatch = (op: Operation, at?: { tx: number; ty: number }, autoIp?: NetTarget): string | null =>
    recorded(() => {
      const outcome = applyOperation(coreOf(get()), op, opContextOf(get()));
      return apply(autoIp ? withAutoIp(outcome, autoIp) : outcome, at);
    });

  // 操作1つを世界に当て、状態に反映する。履歴には積まない（購入・売却・家具の回転など、取り消しの対象外の操作）
  const applyUnrecorded = (op: Operation, at?: { tx: number; ty: number }): string | null =>
    apply(applyOperation(coreOf(get()), op, opContextOf(get())), at);

  // 施工を依頼する（確認を通したあとの処理）
  const buildNow = (): string | null => {
    const focusId = focusedProject(get())?.id;
    const r = requestBuild(coreOf(get()), gameEnv);
    // テストに合格していないと施工を依頼できない。案内を出し、テストのボタンを光らせる
    if (!r.ok && r.reason === 'untested') {
      const at = Date.now();
      set({ lastError: r.reason, testNudge: at });
      return r.reason;
    }
    set({ traces: [] });
    const reason = apply(r);
    // 施工を依頼したら、その案件の履歴は消す（施工後は戻せない）
    if (reason === null && focusId) dropHistory(projectHistoryKey(focusId));
    return reason;
  };

  return { plannedOf, withAutoIp, tileOf, recorded, dropHistory, stepHistory, apply, dispatch, applyUnrecorded, buildNow };
};

export type Ops = ReturnType<typeof createOps>;
