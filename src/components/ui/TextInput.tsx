// 1行の入力欄。種類（text・number・search）と幅（s・m・l・full）で見た目が決まる（ui.css の ui-text-input）。
// onCommit を渡すと、入力中の文字は部品の中に持ち、欄を離れたとき（Enter でも離れる）に onCommit(文字列) を呼ぶ。Esc で value に戻す。
// その場合の value は確定済みの値で、変わると入力中の文字も差し替わる。onChange は渡さない。
// tone が unset のときは、未設定を示す赤い文字にする。配置は layout で渡す（幅も layout の width が優先する）。
import { useState } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export type TextInputType = 'text' | 'number' | 'search' | 'password';
export type TextInputWidth = 's' | 'm' | 'l' | 'full';

interface Props {
  value: string;
  onChange?: (value: string) => void;
  onCommit?: (value: string) => void;
  type?: TextInputType;
  tone?: 'normal' | 'unset';
  width?: TextInputWidth;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  layout?: Layout;
}

export function TextInput({ value, onChange, onCommit, type = 'text', tone = 'normal', width = 'm', label, placeholder, disabled = false, min, max, maxLength, layout }: Props) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const committing = onCommit !== undefined;
  return (
    <input
      type={type}
      className={`ui-text-input ui-text-input--${width}${tone === 'unset' ? ' ui-text-input--unset' : ''}`}
      value={committing ? draft : value}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      min={min}
      max={max}
      maxLength={maxLength}
      onChange={(e) => (committing ? setDraft(e.target.value) : onChange?.(e.target.value))}
      onBlur={committing ? () => onCommit(draft) : undefined}
      onKeyDown={
        committing
          ? (e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') setDraft(value);
            }
          : undefined
      }
      style={layoutStyle(layout)}
    />
  );
}
