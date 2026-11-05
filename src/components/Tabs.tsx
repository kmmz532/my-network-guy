// タブの部品。機材ショップ・機器の画面・採用の画面・ウィンドウのタブの帯で使う。
// 見た目は、パネルの上辺に付いた見出しの形。選んでいるタブはパネルと同じ色でつながり、下の縁がない。選んでいないタブは一段暗く、下の縁がパネルとの境の線になる。
// パネルは tabPanelStyle で作り、タブの下に続けて置く。キー操作は tabNav.ts（左右の矢印で隣、Home と End で先頭と末尾）。
// 押せないタブ（disabled）は薄く出し、選べず、キー操作の対象にもしない。
import { useRef, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
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

// 機材ショップ（パネルは暗い青）と、機器・採用・ウィンドウの画面（#2f4f8f）の色
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
}

const boxStyle = (active: boolean, disabled: boolean | undefined, closable: boolean, colors: TabColors): CSSProperties => ({
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
});

// 上の余白は、選んでいるタブ（下の縁なし）と選んでいないタブ（下の縁あり）の高さが揃うように決める
const labelStyle = (active: boolean, closable: boolean, disabled: boolean | undefined): CSSProperties => ({
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  minWidth: 0,
  padding: `${active ? 5 : 4}px ${closable ? 6 : 10}px 4px 10px`,
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

export function Tabs<T extends string>({ items, selected, onSelect, onClose, colors, idPrefix, ariaLabel, style }: Props<T>) {
  const refs = useRef<Partial<Record<T, HTMLButtonElement | null>>>({});
  const enabled = items.filter((i) => !i.disabled).map((i) => i.id);

  // 矢印キーなどで隣のタブへ移し、そのタブにフォーカスを渡す
  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const next = nextTab(enabled, selected, e.key);
    if (!next) return;
    e.preventDefault();
    onSelect(next);
    refs.current[next]?.focus();
  };

  return (
    <div role="tablist" aria-label={ariaLabel} style={{ display: 'flex', alignItems: 'flex-end', gap: 4, overflowX: 'auto', ...style }}>
      {items.map((item) => {
        const active = item.id === selected;
        const close = onClose && item.closeLabel !== undefined ? onClose : undefined;
        const closeLabel = item.closeLabel;
        return (
          <div
            key={item.id}
            style={boxStyle(active, item.disabled, close !== undefined, colors)}
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
              style={labelStyle(active, close !== undefined, item.disabled)}
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
    </div>
  );
}
