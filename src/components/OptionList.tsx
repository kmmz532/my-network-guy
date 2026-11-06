// 選択肢の一覧の箱（N63）。ComboBox と Select で共通に使う。portal で文書の直下に置き、欄の下（上）に開く。
// 位置の計算は呼び出し側（comboOptions.ts の placeAbove・listHeight）。ここは見た目と行の描画だけを持つ。
import type { ReactNode, RefObject } from 'react';
import { createPortal } from 'react-dom';
import { t } from '../i18n/t';
import { RADIUS } from '../ui/theme';

export const LIST_MAX = 220;
export const ROW_PX = 22;
const MIN_LIST_WIDTH = 180;

// 一覧の位置（欄の画面上の位置）
export interface OptionAnchor {
  left: number;
  width: number;
  top: number;
  bottom: number;
}

// 一覧の1行。selectable が false の行は選べない（使用中など）
export interface OptionItem {
  value: string;
  text: string;
  selectable: boolean;
  usedBy: string | null;
}

interface Props {
  id: string;
  label: string;
  items: OptionItem[];
  active: number | null;
  anchor: OptionAnchor;
  above: boolean;
  listRef?: RefObject<HTMLUListElement>;
  // 下端に固定する行（候補が多くてスクロールしても見える）
  footer?: ReactNode;
  // 行を押したとき（フォーカスは移さない）
  onPick: (value: string) => void;
  // 行に乗せたとき（選べる行のみ）
  onHover: (index: number) => void;
  // 行の最小の高さ（px）。スマホは指で押すため 44 px 以上にする（N63）
  rowMinHeight?: number;
}

// 一覧の箱。listId は ul の id（aria-controls で指す）
export function OptionList({ id, label, items, active, anchor, above, listRef, footer, onPick, onHover, rowMinHeight }: Props) {
  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: anchor.left,
        width: Math.max(anchor.width, MIN_LIST_WIDTH),
        ...(above ? { bottom: window.innerHeight - anchor.top + 2 } : { top: anchor.bottom + 2 }),
        background: '#f4f1e6',
        color: '#3b2a33',
        border: '1px solid #3b2a33',
        borderRadius: RADIUS.none,
        fontSize: 13,
        zIndex: 50,
      }}
    >
      <ul
        id={`${id}-list`}
        ref={listRef}
        role="listbox"
        aria-label={label}
        style={{ maxHeight: LIST_MAX, overflowY: 'auto', margin: 0, padding: 0, listStyle: 'none' }}
      >
        {items.map((o, i) => {
          const highlighted = i === active;
          return (
            <li
              key={o.value}
              id={`${id}-${i}`}
              data-index={i}
              role="option"
              aria-selected={highlighted}
              aria-disabled={o.selectable ? undefined : true}
              onMouseEnter={() => {
                if (o.selectable) onHover(i);
              }}
              // 押したときにフォーカスを移さない（欄を離れたときの確定と競合しないように）
              onMouseDown={(e) => {
                e.preventDefault();
                if (o.selectable) onPick(o.value);
              }}
              style={{
                padding: '2px 6px',
                minHeight: rowMinHeight,
                boxSizing: 'border-box',
                display: rowMinHeight ? 'flex' : undefined,
                alignItems: rowMinHeight ? 'center' : undefined,
                whiteSpace: 'nowrap',
                cursor: o.selectable ? 'pointer' : 'default',
                background: highlighted ? '#25406f' : 'transparent',
                color: highlighted ? '#f4f1e6' : o.selectable ? '#3b2a33' : '#8a8f99',
              }}
            >
              {o.text}
              {o.usedBy !== null && <span style={{ marginLeft: 6, opacity: 0.8 }}>{t('ui.config.usedBy', { name: o.usedBy })}</span>}
            </li>
          );
        })}
      </ul>
      {footer}
    </div>,
    document.body,
  );
}
