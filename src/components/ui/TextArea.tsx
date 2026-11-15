// 複数行の入力欄（ui.css の ui-text-area）。配置は layout で渡す。
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  label?: string;
  placeholder?: string;
  // data は書き出した・貼り付ける生のデータの欄（暗い地・細い枠・小さい文字）
  variant?: 'field' | 'data';
  disabled?: boolean;
  layout?: Layout;
}

export function TextArea({ value, onChange, rows, label, placeholder, variant = 'field', disabled = false, layout }: Props) {
  return (
    <textarea
      className={variant === 'data' ? 'ui-text-area ui-text-area--data' : 'ui-text-area'}
      value={value}
      rows={rows}
      aria-label={label}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
      style={layoutStyle(layout)}
    />
  );
}
