// 候補つきの入力欄（コンボボックス）。欄を押すと候補の一覧が欄の下に開き、打った文字で始まる候補に絞る。
// 確定は、候補を押したとき・Enter（強調した候補がなければ打った値）・欄を離れたとき。
// 形が正しくなければ理由を赤い文字で出し、直前の値に戻す。Esc は一覧を閉じて入力前の値に戻す。
// スマホ・タッチの端末では、欄を押してもキーボードを開かず候補だけを開く（N62）。一覧の下端の「キーボードで入力…」を押したときだけ、キーボードを出す。
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { t, tDyn } from '../../i18n/t';
import { useCoarsePointer, usePhone } from '../../ui/usePhone';
import { filterOptions, isSelectable, listHeight, moveActive, pickOnCommit, placeAbove, type ComboOption } from './comboOptions';
import { layoutStyle, type Layout } from './layout';
import { OptionList, ROW_PX, LIST_MAX, type OptionAnchor } from './OptionList';
import './tokens.css';
import './ui.css';

// 入力欄の画面上の位置。一覧は portal で文書の直下に置くため、ウィンドウの枠で隠れず、はみ出しても見える
type Anchor = OptionAnchor;

const measure = (el: HTMLElement): Anchor => {
  const r = el.getBoundingClientRect();
  return { left: r.left, width: r.width, top: r.top, bottom: r.bottom };
};

export interface ComboBoxProps {
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
  // 配置。幅の既定は 140 px
  layout?: Layout;
}

export function ComboBox({ label, value, options, disabled, isValid, formatError, allowEmpty = false, onCommit, layout }: ComboBoxProps) {
  const id = useId();
  const listId = `${id}-list`;
  const phone = usePhone();
  // 指で操作する端末（iPad など、画面が広くても）は、キーボードを開かない
  const touch = useCoarsePointer();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  // 打ってから確定するまでは、打った文字で候補を絞る
  const [text, setText] = useState(value);
  const [typed, setTyped] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [error, setError] = useState<string | null>(null);
  // スマホで「キーボードで入力…」を押したあと（キーボードを出す状態）
  const [keyboard, setKeyboard] = useState(false);
  // キーボードを出すために欄のフォーカスを付け直すとき、欄を離れた扱いで確定しないための印
  const skipBlurCommit = useRef(false);
  // スマホで候補が1つ以上あるとき、欄を押してもキーボードを開かない（候補だけを開く）
  const keyboardOff = (phone || touch) && !keyboard && options.length > 0;

  // 外から値が変わったとき（候補から選んだときなど）は欄を揃える
  useEffect(() => {
    setText(value);
    setTyped(false);
    setError(null);
  }, [value]);

  // 「キーボードで入力…」を押したら、入力モードを切り替えてから欄を付け直し、キーボードを出す
  useEffect(() => {
    if (!keyboard) return;
    const el = inputRef.current;
    if (!el) return;
    skipBlurCommit.current = true;
    el.blur();
    el.focus();
  }, [keyboard]);

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
  // スマホでは、候補が絞り込みで0件でも、下端の「キーボードで入力…」を出す（入力の手段を残す）
  const listVisible = open && anchor !== null && (shown.length > 0 || keyboardOff);
  const activeOpt = active !== null ? (shown[active] ?? null) : null;
  const footerPx = keyboardOff ? ROW_PX : 0;

  const openList = () => {
    if (inputRef.current) setAnchor(measure(inputRef.current));
    setOpen(true);
  };

  const closeList = () => {
    setOpen(false);
    setActive(null);
    setTyped(false);
    setKeyboard(false);
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
  const listPx = listHeight(shown.length, ROW_PX, LIST_MAX) + footerPx;
  const above = listVisible && placeAbove(window.innerHeight - anchorPos.bottom, anchorPos.top, listPx);

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
        // スマホで候補から選ぶときは、キーボードを開かない（N62）
        inputMode={keyboardOff ? 'none' : 'text'}
        className="ui-combobox"
        style={layoutStyle({ width: 140, ...layout })}
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
        onBlur={() => {
          if (skipBlurCommit.current) {
            skipBlurCommit.current = false;
            return;
          }
          commit(text);
        }}
        onKeyDown={onKeyDown}
      />
      {error && <div className="ui-combobox__error">{error}</div>}
      {listVisible && (
        <OptionList
          id={id}
          label={label}
          items={shown.map((o) => ({ value: o.value, text: o.value, selectable: isSelectable(o), usedBy: o.usedBy }))}
          active={active}
          anchor={anchorPos}
          above={above}
          listRef={listRef}
          onPick={(value) => commit(value)}
          onHover={(i) => setActive(i)}
          footer={
            keyboardOff && (
              // 一覧の下端に固定する（候補が多くて一覧がスクロールしても、常に見える）。押すとキーボードを出す（N62）
              <div
                role="button"
                onMouseDown={(e) => {
                  // フォーカスを移さない（欄を離れた確定を起こさない）
                  e.preventDefault();
                  setKeyboard(true);
                }}
                className="ui-option-footer"
                style={{ height: ROW_PX }}
              >
                {t('ui.combo.keyboard')}
              </div>
            )
          }
        />
      )}
    </div>
  );
}
