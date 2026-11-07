// 画面の通知（N96）。種類の表（文言のキー・開く画面・消えるか・まとめるか）と、通知の列の扱い（最大3件・期限・まとめ）。純粋な関数。
// 表にない種類は例外にする（R5）。

// 押したときに開く画面（ない種類は押せない）。採用の画面は、ストアの採用の要求で開く
export type NoticeOpen = 'funds' | 'offers' | 'hiring' | 'staff' | 'staffList';

interface NoticeSpec {
  key: string;
  open: NoticeOpen | null;
  // 押して閉じるまで消えない（給与を払えない月の知らせ）
  sticky: boolean;
}

export const NOTICE_KINDS = {
  salary: { key: 'ui.notice.salary', open: 'funds', sticky: false },
  payPause: { key: 'ui.notice.payPause', open: 'funds', sticky: true },
  delegated: { key: 'ui.notice.delegated', open: 'offers', sticky: false },
  // ゲームの出来事（N97）
  salesArrival: { key: 'ui.notice.salesArrival', open: 'offers', sticky: false },
  offersRefreshed: { key: 'ui.notice.offersRefreshed', open: 'offers', sticky: false },
  candidatesRefreshed: { key: 'ui.notice.candidatesRefreshed', open: 'hiring', sticky: false },
  hired: { key: 'ui.notice.hired', open: 'staff', sticky: false },
  capRaised: { key: 'ui.notice.capRaised', open: 'hiring', sticky: false },
  capReached: { key: 'ui.notice.capReached', open: 'hiring', sticky: false },
  trained: { key: 'ui.notice.trained', open: 'staff', sticky: false },
  retired: { key: 'ui.notice.retired', open: 'staffList', sticky: false },
  // 上限に達して、昇給を待っている社員（N101）
  raiseWaiting: { key: 'ui.notice.raiseWaiting', open: 'staff', sticky: false },
} as const satisfies Record<string, NoticeSpec>;

export type NoticeKind = keyof typeof NOTICE_KINDS;

export interface NoticeItem {
  id: number;
  kind: NoticeKind;
  params: Record<string, number | string>;
  // まとめた件数（1件のときは1）
  count: number;
  // 表示を始めた時刻。null は前の通知が消えるまで待っている
  shownAt: number | null;
}

// 同時に出す件数（縦に重ねる）と、表示の時間（ms）
export const NOTICE_MAX_VISIBLE = 3;
export const NOTICE_MS = 3000;

const specOf = (kind: string): NoticeSpec => {
  const spec = (NOTICE_KINDS as Record<string, NoticeSpec>)[kind];
  if (!spec) throw new Error(`通知の種類が表にない: ${kind}`);
  return spec;
};

// 通知の列に積む。同じ種類がまとめられるものは1件にまとめる。最大件数を超えたものは、前が消えるまで待つ
export const pushNotice = (list: readonly NoticeItem[], kind: NoticeKind, params: Record<string, number | string>, now: number): NoticeItem[] => {
  const spec = specOf(kind);
  let next: NoticeItem[];
  // 同じ種類が続いたら、1件にまとめる（件数は params.count）。押して閉じる通知はまとめない
  const same = spec.sticky ? undefined : [...list].reverse().find((n) => n.kind === kind && !specOf(n.kind).sticky);
  if (same) {
    next = list.map((n) => (n.id === same.id ? { ...n, count: n.count + 1, params: { ...params, count: n.count + 1 } } : n));
  } else {
    const id = list.reduce((max, n) => Math.max(max, n.id), 0) + 1;
    next = [...list, { id, kind, params, count: 1, shownAt: null }];
  }
  return promoteNotices(next, now);
};

// 期限の過ぎた通知を消し、待っている通知を空きの分だけ表示に移す（押して閉じる通知は消えない）
export const promoteNotices = (list: readonly NoticeItem[], now: number): NoticeItem[] => {
  const kept = list.filter((n) => {
    if (n.shownAt === null) return true;
    if (specOf(n.kind).sticky) return true;
    return now - n.shownAt < NOTICE_MS;
  });
  let visible = kept.filter((n) => n.shownAt !== null).length;
  return kept.map((n) => {
    if (n.shownAt !== null || visible >= NOTICE_MAX_VISIBLE) return n;
    visible++;
    return { ...n, shownAt: now };
  });
};

// 押して閉じる（通知の1件を消す）
export const dismissNotice = (list: readonly NoticeItem[], id: number): NoticeItem[] => list.filter((n) => n.id !== id);

// 表示している通知
export const visibleNotices = (list: readonly NoticeItem[]): NoticeItem[] => list.filter((n) => n.shownAt !== null);

// 押したときに開く画面（null は押せない）
export const openOf = (kind: NoticeKind): NoticeOpen | null => specOf(kind).open;
