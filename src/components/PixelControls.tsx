// ブラウザ標準の部品の代わりに使う、画面の中の選択の部品（ART.md の角と色の決まり）。
// PixelCheck: チェックボックス。中の入力欄は残し（キーボードと読み上げのため）、見た目だけを箱と線にする。
// PixelSelect: 一覧から1つ選ぶ部品。開くと、ボタンの下に一覧を出す。Esc と、外を押すと閉じる。
import { captureKeys } from '../input/keyRouter';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { RADIUS } from '../ui/theme';

const BOX = { width: 14, height: 14, border: '2px solid #3b2a33', background: '#f4f1e6', position: 'relative', flexShrink: 0 } as const;

export function PixelCheck({
  checked,
  disabled,
  onChange,
  children,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1 }}>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        style={{ position: 'absolute', opacity: 0, width: 1, height: 1, margin: 0 }}
      />
      <span style={{ ...BOX, background: checked ? '#ffd866' : '#f4f1e6' }} aria-hidden>
        {checked && (
          <span
            style={{
              position: 'absolute',
              left: 3,
              top: 0,
              width: 4,
              height: 8,
              borderRight: '2px solid #3b2a33',
              borderBottom: '2px solid #3b2a33',
              transform: 'rotate(45deg)',
            }}
          />
        )}
      </span>
      {children}
    </label>
  );
}

interface Option<T extends string | number> {
  value: T;
  label: string;
}

export function PixelSelect<T extends string | number>({
  value,
  options,
  onChange,
  disabled,
  ariaLabel,
  style,
}: {
  value: T;
  options: Option<T>[];
  onChange: (value: T) => void;
  disabled?: boolean;
  ariaLabel: string;
  style?: CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    // 一覧を開いているあいだの Esc は、一覧を閉じるだけにする（ほかの画面は閉じない）
    const releaseKeys = captureKeys((e) => {
      if (e.key !== 'Escape') return false;
      setOpen(false);
      return true;
    });
    window.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      releaseKeys();
    };
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-block', maxWidth: 150, ...style }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          width: '100%',
          padding: '2px 6px',
          cursor: disabled ? 'default' : 'pointer',
          background: '#f4f1e6',
          color: '#3b2a33',
          border: '2px solid #3b2a33',
          borderRadius: RADIUS.none,
          fontFamily: 'inherit',
          fontSize: 13,
          opacity: disabled ? 0.5 : 1,
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{current?.label ?? ''}</span>
        {/* 下向きの三角は、線で描く（文字の記号を使わない） */}
        <span aria-hidden style={{ width: 0, height: 0, borderLeft: '4px solid transparent', borderRight: '4px solid transparent', borderTop: '5px solid #3b2a33', flexShrink: 0 }} />
      </button>
      {open && (
        <div
          role="listbox"
          aria-label={ariaLabel}
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            zIndex: 20,
            minWidth: '100%',
            maxHeight: 220,
            overflowY: 'auto',
            background: '#f4f1e6',
            border: '2px solid #3b2a33',
            boxSizing: 'border-box',
          }}
        >
          {options.map((o) => {
            const on = o.value === value;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="option"
                aria-selected={on}
                onClick={() => {
                  setOpen(false);
                  onChange(o.value);
                }}
                style={{
                  display: 'block',
                  width: '100%',
                  padding: '3px 6px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  background: on ? '#ffd866' : 'transparent',
                  color: '#3b2a33',
                  border: 'none',
                  fontFamily: 'inherit',
                  fontSize: 13,
                  whiteSpace: 'nowrap',
                }}
              >
                {o.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
