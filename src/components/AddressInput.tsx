// IPアドレスの欄（コンボボックス）。欄を押すと候補の一覧が欄の下に開き、打った文字で始まる候補に絞る。
// 確定は、候補を押したとき・Enter（強調した候補がなければ打った値）・欄を離れたとき。
// 形が正しくなければ理由を赤い文字で出し、直前の値に戻す。Esc は一覧を閉じて入力前の値に戻す。
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { t, tDyn } from '../i18n/t';
import { filterOptions, isSelectable, listHeight, moveActive, pickOnCommit, placeAbove, type ComboOption } from './addressCombo';
import { inputStyle, unsetColor } from './devicePorts';
import { RADIUS } from '../ui/theme';

const LIST_MAX = 220;
const ROW_PX = 22;
const MIN_LIST_WIDTH = 180;

// 入力欄の画面上の位置。一覧は portal で文書の直下に置くため、ウィンドウの枠で隠れず、はみ出しても見える
interface Anchor {
  left: number;
  width: number;
  top: number;
  bottom: number;
}

const measure = (el: HTMLElement): Anchor => {
  const r = el.getBoundingClientRect();
  return { left: r.left, width: r.width, top: r.top, bottom: r.bottom };
};

interface Props {
  label: string;
  // 確定している値（空なら未設定）
  value: string;
  options: ComboOption[];
  disabled: boolean;
  // 形の確かめ。正しくなければ formatError を出す
  isValid: (s: string) => boolean;
  formatError: string;
  // 空の値の確定を許すか（ゲートウェイは空で解除する）
  allowEmpty?: boolean;
  // 確定する。理由（ui.error.* のキー）を返したら、その理由を出して直前の値に戻す
  onCommit: (v: string) => string | null;
}

export function AddressInput({ label, value, options, disabled, isValid, formatError, allowEmpty = false, onCommit }: Props) {
  const id = useId();
  const listId = `${id}-list`;
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [text, setText] = useState(value);
  // 打ってから確定するまでは、打った文字で候補を絞る
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [error, setError] = useState<string | null>(null);

  // 外から値が変わったとき（候補から選んだときなど）は欄を揃える
  useEffect(() => {
    setText(value);
    setTyped(false);
    setError(null);
  }, [value]);

  // 一覧を開いている間、ウィンドウの大きさや位置が変わったら一覧の位置を合わせる
  useEffect(() => {
    if (!open) return;
    const follow = () => {
      if (inputRef.current) setAnchor(measure(inputRef.current));
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open]);

  // 矢印で動かした候補が一覧の外にあれば、見える位置までスクロールする
  useEffect(() => {
    if (active === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const shown = open ? filterOptions(options, typed ? text : '') : [];
  const listVisible = open && shown.length > 0 && anchor !== null;
  const activeOpt = active !== null ? (shown[active] ?? null) : null;

  const openList = () => {
    if (inputRef.current) setAnchor(measure(inputRef.current));
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    setActive(null);
    setTyped(false);
  };

  const commit = (raw: string) => {
    const v = raw.trim();
    closeList();
    if (v === value || (v === '' && !allowEmpty)) {
      setText(value);
      setError(null);
      return;
    }
    if (v !== '' && !isValid(v)) {
      setError(formatError);
      setText(value);
      return;
    }
    const reason = onCommit(v);
    if (reason) {
      setError(tDyn(`ui.error.${reason}`));
      setText(value);
    } else {
      setError(null);
      setText(v);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // 入力欄に入力中は、Tab 以外のキーをウィンドウ全体のキー操作へ渡さない
    if (e.key !== 'Tab') e.stopPropagation();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const delta = e.key === 'ArrowDown' ? 1 : -1;
      if (!open) {
        const all = filterOptions(options, typed ? text : '');
        openList();
        setActive(moveActive(all, null, delta));
      } else {
        setActive(moveActive(shown, active, delta));
      }
    } else if (e.key === 'Enter') {
      e.preventDefault();
      commit(pickOnCommit(text, activeOpt));
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setText(value);
      setError(null);
      closeList();
    }
  };

  const anchorPos = anchor ?? { left: 0, width: 0, top: 0, bottom: 0 };
  const above = listVisible && placeAbove(window.innerHeight - anchorPos.bottom, anchorPos.top, listHeight(shown.length, ROW_PX, LIST_MAX));

  return (
    <div>
      <input
        ref={inputRef}
        role="combobox"
        aria-label={label}
        aria-expanded={listVisible}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={listVisible && active !== null ? `${id}-${active}` : undefined}
        autoComplete="off"
        style={{ ...inputStyle, width: 140 }}
        value={text}
        disabled={disabled}
        onFocus={(e) => {
          e.target.select();
          openList();
        }}
        onClick={() => {
          if (!open) openList();
        }}
        onChange={(e) => {
          setText(e.target.value);
          setTyped(true);
          setActive(null);
          if (!open) openList();
        }}
        onBlur={() => commit(text)}
        onKeyDown={onKeyDown}
      />
      {error && <div style={{ color: unsetColor }}>{error}</div>}
      {listVisible &&
        createPortal(
          <ul
            id={listId}
            ref={listRef}
            role="listbox"
            aria-label={label}
            style={{
              position: 'fixed',
              left: anchorPos.left,
              width: Math.max(anchorPos.width, MIN_LIST_WIDTH),
              ...(above ? { bottom: window.innerHeight - anchorPos.top + 2 } : { top: anchorPos.bottom + 2 }),
              maxHeight: LIST_MAX,
              overflowY: 'auto',
              margin: 0,
              padding: 0,
              listStyle: 'none',
              background: '#f4f1e6',
              color: '#3b2a33',
              border: '1px solid #3b2a33',
              borderRadius: RADIUS.none,
              fontSize: 13,
              zIndex: 50,
            }}
          >
            {shown.map((o, i) => {
              const selectable = isSelectable(o);
              const highlighted = i === active;
              return (
                <li
                  key={o.value}
                  id={`${id}-${i}`}
                  data-index={i}
                  role="option"
                  aria-selected={highlighted}
                  aria-disabled={selectable ? undefined : true}
                  onMouseEnter={() => {
                    if (selectable) setActive(i);
                  }}
                  // 押したときにフォーカスを移さない（欄を離れたときの確定と競合しないように）
                  onMouseDown={(e) => {
                    e.preventDefault();
                    if (selectable) commit(o.value);
                  }}
                  style={{
                    padding: '2px 6px',
                    whiteSpace: 'nowrap',
                    cursor: selectable ? 'pointer' : 'default',
                    background: highlighted ? '#25406f' : 'transparent',
                    color: highlighted ? '#f4f1e6' : selectable ? '#3b2a33' : '#8a8f99',
                  }}
                >
                  {o.value}
                  {o.usedBy !== null && <span style={{ marginLeft: 6, opacity: 0.8 }}>{t('ui.config.usedBy', { name: o.usedBy })}</span>}
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
    </div>
  );
}
