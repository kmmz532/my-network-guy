// タブの部品。ショップ・機器の画面・採用の画面・ウィンドウのタブの帯で使う。
// 見た目は、パネルの上辺に付いた見出しの形。選んでいるタブはパネルと同じ色でつながり、下の縁がない。選んでいないタブは一段暗く、下の縁がパネルとの境の線になる。
// パネルは tabPanelStyle で作り、タブの下に続けて置く。キー操作は tabNav.ts（左右の矢印で隣、Home と End で先頭と末尾）。
// 押せないタブ（disabled）は薄く出し、選べず、キー操作の対象にもしない。
// 帯の幅に収まらないときは横にスクロールし、ホイール（縦の回転を横に変換）・左右の矢印のボタンで送る。選んだタブは見える位置まで送る。
// reorderable を付けた帯だけ、ドラッグでタブの並べ替えを行う（開いて増えるウィンドウのタブ）。
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { nextTab } from './tabNav';
import { RADIUS } from '../ui/theme';

const BORDER = '#3b2a33';
const TEXT = '#f4f1e6';

export interface TabColors {
  // 選んでいるタブと、その下のパネルの背景（同じ色にする）
  selected: string;
  // 選んでいないタブの背景（selected より暗くする）
  idle: string;
}

// ショップ（パネルは暗い青）と、機器・採用・ウィンドウの画面（#2f4f8f）の色
export const TAB_COLORS: Record<'shop' | 'window', TabColors> = {
  shop: { selected: '#1d3664', idle: '#16294f' },
  window: { selected: '#2f4f8f', idle: '#25406f' },
};

// タブの下に続けるパネルの見た目。上の縁はタブの下の縁に重ねる（-1 px）
export const tabPanelStyle = (bg: string): CSSProperties => ({
  background: bg,
  border: `1px solid ${BORDER}`,
  borderRadius: RADIUS.none,
  padding: 8,
  marginTop: -1,
});

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  icon?: ReactNode;
  // 閉じる×の読み上げ名。onClose が渡されているときだけ×を出す
  closeLabel?: string;
  // 押せないタブ
  disabled?: boolean;
}

interface Props<T extends string> {
  items: readonly TabItem<T>[];
  selected: T;
  onSelect: (id: T) => void;
  // 閉じるの処理（×のクリックと、中ボタンのクリック）
  onClose?: (id: T) => void;
  colors: TabColors;
  // 指定すると、タブのボタンに `${idPrefix}-${id}` の id を付ける（パネルの aria-labelledby 用）
  idPrefix?: string;
  ariaLabel?: string;
  style?: CSSProperties;
  // 指定すると、タブの高さをこの px に固定する（中身が大きくても高さは変わらず、はみ出しは切る）
  tabHeight?: number;
  // 指定すると、ドラッグでタブを並べ替えられる。onReorder は (from, to) の位置（番号）を受け取る
  reorderable?: boolean;
  onReorder?: (from: number, to: number) => void;
}

const boxStyle = (active: boolean, disabled: boolean | undefined, closable: boolean, colors: TabColors, tabHeight: number | undefined): CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  flexShrink: 0,
  maxWidth: 180,
  position: 'relative',
  zIndex: 1,
  paddingRight: closable ? 2 : 0,
  border: `1px solid ${BORDER}`,
  borderBottom: active ? 'none' : `1px solid ${BORDER}`,
  borderRadius: `${RADIUS.tab}px ${RADIUS.tab}px 0 0`,
  background: active ? colors.selected : colors.idle,
  color: TEXT,
  opacity: disabled ? 0.4 : 1,
  ...(tabHeight !== undefined ? { height: tabHeight, boxSizing: 'border-box' as const, overflow: 'hidden' } : {}),
});

// 上の余白は、選んでいるタブ（下の縁なし）と選んでいないタブ（下の縁あり）の高さが揃うように決める
// 高さを固定したとき（tabHeight）は、ボタンを箱の高さいっぱいに広げ、中身は縦の中央に置く（中身が高くても箱からはみ出さない）
const labelStyle = (active: boolean, closable: boolean, disabled: boolean | undefined, fixed: boolean): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  ...(fixed
    ? { height: '100%', boxSizing: 'border-box', lineHeight: '20px', padding: `0 ${closable ? 6 : 10}px 0 10px` }
    : { padding: `${active ? 5 : 4}px ${closable ? 6 : 10}px 4px 10px` }),
  background: 'transparent',
  color: 'inherit',
  border: 'none',
  font: 'inherit',
  fontSize: 14,
  fontWeight: active ? 'bold' : 'normal',
  whiteSpace: 'nowrap',
  cursor: disabled ? 'default' : 'pointer',
});

const closeStyle: CSSProperties = {
  flexShrink: 0,
  width: 18,
  height: 18,
  padding: 0,
  cursor: 'pointer',
  background: 'transparent',
  color: 'inherit',
  border: 'none',
  font: 'inherit',
  lineHeight: '16px',
};

// 矢印のボタンで1回に送る幅（px）
const SCROLL_STEP = 120;
// ドラッグと判定するまでの移動（px）。これより小さい動きは押して選ぶままにする
const DRAG_PX = 6;

const arrowStyle: CSSProperties = {
  flexShrink: 0,
  alignSelf: 'center',
  width: 20,
  height: 22,
  padding: 0,
  cursor: 'pointer',
  background: '#25406f',
  color: TEXT,
  border: `1px solid ${BORDER}`,
  borderRadius: RADIUS.none,
  font: 'inherit',
  lineHeight: '18px',
};

export function Tabs<T extends string>({
  items,
  selected,
  onSelect,
  onClose,
  colors,
  idPrefix,
  ariaLabel,
  style,
  tabHeight,
  reorderable,
  onReorder,
}: Props<T>) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const scroller = useRef<HTMLDivElement | null>(null);
  const enabled = items.filter((i) => !i.disabled).map((i) => i.id);
  // 帯の幅に収まらないか（矢印を出すか）
  const [overflowing, setOverflowing] = useState(false);
  // ドラッグの途中（押した位置・動かしたか）と、挿入する位置（番号と左端の px）
  const drag = useRef<{ from: number; x: number; moved: boolean } | null>(null);
  const [drop, setDrop] = useState<{ at: number; left: number } | null>(null);
  // ドラッグで並べ替えたあとに届く、押して離した（クリック）を捨てる
  const justDragged = useRef(false);

  // 幅に収まるかを測り直す（タブが増えた・画面の大きさが変わった・送った）
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 1);
    check();
    el.addEventListener('scroll', check);
    window.addEventListener('resize', check);
    return () => {
      el.removeEventListener('scroll', check);
      window.removeEventListener('resize', check);
    };
  }, [items.length]);

  // ホイールの縦の回転を横の送りに変える（送れるときだけ。送れないときは既定の動きに任せる）
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (el.scrollWidth <= el.clientWidth) return;
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // 選んだタブが見える位置まで送る
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const box = Array.from(el.querySelectorAll<HTMLElement>('[data-tab]')).find((b) => b.dataset.tab === String(selected));
    if (!box) return;
    if (box.offsetLeft < el.scrollLeft) el.scrollLeft = box.offsetLeft;
    else if (box.offsetLeft + box.offsetWidth > el.scrollLeft + el.clientWidth) el.scrollLeft = box.offsetLeft + box.offsetWidth - el.clientWidth;
  }, [selected]);

  // 矢印キーなどで隣のタブへ移し、そのタブにフォーカスを渡す
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTab(enabled, selected, e.key);
    if (!next) return;
    e.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  };

  // 押した位置から、並べ替えの挿入位置（何番目の前か）を求める。タブの中心より左にある数
  const insertionAt = (clientX: number): { at: number; left: number } => {
    const el = scroller.current;
    const boxes = el ? Array.from(el.querySelectorAll<HTMLElement>('[data-tab]')) : [];
    let at = 0;
    for (const box of boxes) {
      const r = box.getBoundingClientRect();
      if (r.left + r.width / 2 < clientX) at++;
    }
    const last = boxes[boxes.length - 1];
    const left = at < boxes.length ? boxes[at].offsetLeft : last ? last.offsetLeft + last.offsetWidth : 0;
    return { at, left };
  };

  const onPointerDown = (index: number) => (e: PointerEvent<HTMLDivElement>) => {
    if (!reorderable || !onReorder || e.button !== 0) return;
    drag.current = { from: index, x: e.clientX, moved: false };
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    if (!d.moved) {
      if (Math.abs(e.clientX - d.x) < DRAG_PX) return;
      d.moved = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDrop(insertionAt(e.clientX));
  };

  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!d || !d.moved || !drop || !onReorder) {
      setDrop(null);
      return;
    }
    // 挿入位置から、外したあとの番号を求める（前から後ろへ動かしたときは1つ詰まる）
    const to = drop.at > d.from ? drop.at - 1 : drop.at;
    setDrop(null);
    if (to !== d.from) {
      justDragged.current = true;
      onReorder(d.from, to);
    }
  };

  const send = (dir: -1 | 1) => {
    const el = scroller.current;
    if (el) el.scrollLeft += dir * SCROLL_STEP;
  };

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, minWidth: 0, ...style }}>
      {overflowing && (
        <button type="button" aria-label="左へ送る" onClick={() => send(-1)} style={arrowStyle}>
          ‹
        </button>
      )}
      <div
        ref={scroller}
        role="tablist"
        aria-label={ariaLabel}
        // 横にスクロールする（改行しない）
        style={{ display: 'flex', alignItems: 'flex-end', gap: 4, overflowX: 'auto', minWidth: 0, flex: 1, position: 'relative', scrollbarWidth: 'thin' }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onClickCapture={(e) => {
          // ドラッグで並べ替えたあとは、離した位置による選ぶ・閉じるを行わない
          if (!justDragged.current) return;
          justDragged.current = false;
          e.stopPropagation();
          e.preventDefault();
        }}
      >
        {items.map((item, index) => {
          const active = item.id === selected;
          const close = onClose && item.closeLabel !== undefined ? onClose : undefined;
          const closeLabel = item.closeLabel;
          return (
            <div
              key={item.id}
              data-tab={String(item.id)}
              style={boxStyle(active, item.disabled, close !== undefined, colors, tabHeight)}
              onPointerDown={reorderable && !item.disabled ? onPointerDown(index) : undefined}
              // 中ボタンで閉じる（閉じられるタブだけ）。既定の自動スクロールは Window の mousedown で止める
              onAuxClick={
                close
                  ? (e) => {
                      if (e.button !== 1) return;
                      e.preventDefault();
                      close(item.id);
                    }
                  : undefined
              }
            >
              <button
                type="button"
                role="tab"
                id={idPrefix ? `${idPrefix}-${item.id}` : undefined}
                ref={(el) => {
                  refs.current[item.id] = el;
                }}
                aria-selected={active}
                aria-disabled={item.disabled || undefined}
                disabled={item.disabled}
                tabIndex={active ? 0 : -1}
                style={labelStyle(active, close !== undefined, item.disabled, tabHeight !== undefined)}
                onClick={() => onSelect(item.id)}
                onKeyDown={onKeyDown}
              >
                {item.icon}
                <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{item.label}</span>
              </button>
              {close && closeLabel !== undefined && (
                <button
                  type="button"
                  aria-label={closeLabel}
                  // タブを選ぶ処理を始めないよう、押した位置の処理を止める
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    close(item.id);
                  }}
                  style={closeStyle}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}
        {drop && (
          <div
            aria-hidden="true"
            style={{ position: 'absolute', left: drop.left - 2, top: 0, bottom: 0, width: 3, background: '#ffd866', pointerEvents: 'none', zIndex: 3 }}
          />
        )}
      </div>
      {overflowing && (
        <button type="button" aria-label="右へ送る" onClick={() => send(1)} style={arrowStyle}>
          ›
        </button>
      )}
    </div>
  );
}
