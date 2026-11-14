// 1行の入力欄。種類（text・number・search）と幅（s・m・l・full）で見た目が決まる（ui.css の ui-text-input）。
// tone が unset のときは、未設定を示す赤い文字にする。配置は layout で渡す（幅も layout の width が優先する）。
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export type TextInputType = 'text' | 'number' | 'search';
export type TextInputWidth = 's' | 'm' | 'l' | 'full';

interface Props {
  value: string;
  onChange: (value: string) => void;
  type?: TextInputType;
  tone?: 'normal' | 'unset';
  width?: TextInputWidth;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  min?: number;
  max?: number;
  layout?: Layout;
}

export function TextInput({ value, onChange, type = 'text', tone = 'normal', width = 'm', label, placeholder, disabled = false, min, max, layout }: Props) {
  return (
    <input
      type={type}
      className={`ui-text-input ui-text-input--${width}${tone === 'unset' ? ' ui-text-input--unset' : ''}`}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      min={min}
      max={max}
      onChange={(e) => onChange(e.target.value)}
      style={layoutStyle(layout)}
    />
  );
}
