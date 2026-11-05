// 設計中の操作の取り消し・やり直し（純粋関数）。履歴は案件ごと・自社オフィスごとに持ち、保存しない。
// 1つの項目は、対象（案件または自社オフィス）の操作前・操作後の状態と、操作による資金・在庫の差分を持つ。
// 元に戻すと対象は操作前に戻し、資金と在庫は差分を逆に足す（資金と在庫の全体の値は持たない）。
import { focusedOf, type Core, type Office, type Outcome, type Project } from './project';

// 1つの履歴が持つ操作の最大数。超えたら古いものから消す
export const HISTORY_LIMIT = 50;

// 過去（done）と、取り消した操作（undone）の列。過去は古いものが先頭、取り消しは直近に取り消したものが先頭
export interface History<T> {
  past: T[];
  future: T[];
}

export const emptyHistory = <T>(): History<T> => ({ past: [], future: [] });

// 操作を積む。新しい操作をしたら、やり直しの履歴は消す。上限を超えたら古いものから消す
export const push = <T>(h: History<T>, entry: T): History<T> => ({
  past: [...h.past, entry].slice(-HISTORY_LIMIT),
  future: [],
});

// 直近の操作を取り消す。取り消した項目を返す（戻せなければ null）
export const undo = <T>(h: History<T>): { history: History<T>; entry: T } | null => {
  if (h.past.length === 0) return null;
  const entry = h.past[h.past.length - 1];
  return { history: { past: h.past.slice(0, -1), future: [entry, ...h.future] }, entry };
};

// 取り消した操作をやり直す。やり直した項目を返す（やり直せなければ null）
export const redo = <T>(h: History<T>): { history: History<T>; entry: T } | null => {
  if (h.future.length === 0) return null;
  const [entry, ...rest] = h.future;
  return { history: { past: [...h.past, entry].slice(-HISTORY_LIMIT), future: rest }, entry };
};

// 履歴を空にする（施工の依頼・取り消し・自社案件の受注のあと）
export const clear = <T>(): History<T> => emptyHistory();

// 自社オフィスの履歴のキー。案件の履歴のキーは案件のIDから作る
export const OFFICE_HISTORY_KEY = 'office';
export const projectHistoryKey = (id: string): string => `project:${id}`;

// 今の設計の対象（設計中の案件、なければ自社オフィス）の履歴のキー
export const historyKeyOf = (focused: Project | null): string =>
  focused ? projectHistoryKey(focused.id) : OFFICE_HISTORY_KEY;

// 設計の対象の状態（案件か自社オフィス）
export type DesignTarget = { kind: 'project'; project: Project } | { kind: 'office'; office: Office };

// 操作の1項目。before・after は対象の状態、差分は資金・在庫・案件の費用の増減
export interface DesignEntry {
  before: DesignTarget;
  after: DesignTarget;
  moneyDelta: number;
  ownedDelta: Record<string, number>;
  // 案件の費用（Project.cost）の増減。自社オフィスの操作では 0
  costDelta: number;
}

// 操作の前後の状態から、操作の項目を作る（操作が成功したあとに呼ぶ）
export const entryOf = (before: Core, after: Core): DesignEntry => {
  const bp = focusedOf(before);
  const ap = focusedOf(after);
  const ownedDelta: Record<string, number> = {};
  for (const id of new Set([...Object.keys(before.owned), ...Object.keys(after.owned)])) {
    const d = (after.owned[id] ?? 0) - (before.owned[id] ?? 0);
    if (d !== 0) ownedDelta[id] = d;
  }
  return {
    before: bp ? { kind: 'project', project: bp } : { kind: 'office', office: before.office },
    after: ap ? { kind: 'project', project: ap } : { kind: 'office', office: after.office },
    moneyDelta: after.clock.money - before.clock.money,
    ownedDelta,
    costDelta: bp && ap ? ap.cost - bp.cost : 0,
  };
};

// 項目を取り消す（dir: undo）またはやり直す（dir: redo）。対象は操作の前か後の状態に置き換え、資金・在庫・費用は差分を足し引きする。
// 資金か在庫が負になるときは戻さず、dir を理由に失敗する
export const stepDesign = (core: Core, entry: DesignEntry, dir: 'undo' | 'redo'): Outcome => {
  const sign = dir === 'undo' ? -1 : 1;
  const money = core.clock.money + sign * entry.moneyDelta;
  if (money < 0) return { ok: false, reason: dir };
  const owned = { ...core.owned };
  for (const [id, d] of Object.entries(entry.ownedDelta)) {
    const n = (owned[id] ?? 0) + sign * d;
    if (n < 0) return { ok: false, reason: dir };
    owned[id] = n;
  }
  const target = dir === 'undo' ? entry.before : entry.after;
  const base: Core = { ...core, clock: { ...core.clock, money }, owned };
  if (target.kind === 'office') return { ok: true, core: { ...base, office: target.office } };
  const cur = focusedOf(core);
  if (!cur || cur.id !== target.project.id) return { ok: false, reason: 'none' };
  // 設計を変えたので、テストの結果は無効になる。費用は今の値に差分を足す（ほかの操作の費用を消さないため）
  const project: Project = { ...target.project, cost: cur.cost + sign * entry.costDelta, testedOk: false };
  return { ok: true, core: { ...base, active: core.active.map((p) => (p.id === project.id ? project : p)) } };
};
