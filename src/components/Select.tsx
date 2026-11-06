// 選択ボックス（N63）。ブラウザ標準の <select> の代わりに使う。押すと選択肢の一覧が欄の下（下に収まらなければ上）に開く。
// 欄は ComboBox と同じ見た目（devicePorts の inputStyle）。文字は打てず、右端に下向きの印を付ける。
// 一覧の箱は OptionList（ComboBox と共通）。操作: 押して開く・項目を押して確定・外を押すか Esc で閉じる・↑↓で動かし Enter で確定。
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { usePhone } from '../ui/usePhone';
import { listHeight, moveActive, placeAbove } from './comboOptions';
import { inputStyle } from './devicePorts';
import { OptionList, ROW_PX, LIST_MAX, type OptionAnchor } from './OptionList';

export interface SelectOption {
  value: string;
  label: string;
}

interface Props {
  label: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  style?: CSSProperties;
}

const measure = (el: HTMLElement): OptionAnchor => {
  const r = el.getBoundingClientRect();
  return { left: r.left, width: r.width, top: r.top, bottom: r.bottom };
};

// スマホで指で押せるように、行を 44 px 以上にする（M4）
const PHONE_ROW_PX = 44;

export function Select({ label, value, options, onChange, disabled = false, style }: Props) {
  const id = useId();
  const phone = usePhone();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<OptionAnchor | null>(null);
  const rowPx = phone ? PHONE_ROW_PX : ROW_PX;
  const current = options.findIndex((o) => o.value === value);
  const currentLabel = current >= 0 ? options[current].label : '';

  // 一覧を開いている間、外を押したら閉じる（一覧の中・欄は除く）
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[role="listbox"]') || buttonRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  // ウィンドウの大きさや位置が変わったら、一覧の位置を合わせる
  useEffect(() => {
    if (!open) return;
    const follow = () => {
      if (buttonRef.current) setAnchor(measure(buttonRef.current));
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, true);
    return () => {
      window.removeEventListener('resize', follow);
      window.removeEventListener('scroll', follow, true);
    };
  }, [open]);

  // 矢印で動かした行が一覧の外にあれば、見える位置までスクロールする
  useEffect(() => {
    if (active === null) return;
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`);
    el?.scrollIntoView?.({ block: 'nearest' });
  }, [active]);

  const openList = () => {
    if (disabled) return;
    if (buttonRef.current) setAnchor(measure(buttonRef.current));
    setActive(current >= 0 ? current : null);
    setOpen(true);
  };

  const pick = (v: string) => {
    setOpen(false);
    setActive(null);
    if (v !== value) onChange(v);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    // 欄にいるときは、Tab 以外のキーをウィンドウ全体のキー操作へ渡さない
    if (e.key !== 'Tab') e.stopPropagation();
    if (!open) {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      // 選択肢はすべて選べる（使用中の行はない）
      const all = options.map((o) => ({ value: o.value, usedBy: null }));
      setActive(moveActive(all, active, e.key === 'ArrowDown' ? 1 : -1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active !== null) pick(options[active].value);
      else setOpen(false);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      setOpen(false);
      setActive(null);
    }
  };

  const anchorPos = anchor ?? { left: 0, width: 0, top: 0, bottom: 0 };
  const above = open && placeAbove(window.innerHeight - anchorPos.bottom, anchorPos.top, listHeight(options.length, rowPx, LIST_MAX));

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKeyDown}
        style={{
          ...inputStyle,
          width: 'auto',
          minWidth: 120,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 8,
          textAlign: 'left',
          cursor: disabled ? 'default' : 'pointer',
          ...style,
        }}
      >
        <span>{currentLabel}</span>
        <span aria-hidden="true" style={{ fontSize: 10 }}>
          ▼
        </span>
      </button>
      {open && (
        <OptionList
          id={id}
          label={label}
          items={options.map((o) => ({ value: o.value, text: o.label, selectable: true, usedBy: null }))}
          active={active}
          anchor={anchorPos}
          above={above}
          listRef={listRef}
          rowMinHeight={phone ? PHONE_ROW_PX : undefined}
          onPick={pick}
          onHover={(i) => setActive(i)}
        />
      )}
    </>
  );
}

