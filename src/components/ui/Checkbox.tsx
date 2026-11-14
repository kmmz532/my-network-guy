// 文字つきのチェックボックス。ブラウザ標準の四角に、右へ文字（children）を並べる。
// label は読み上げの名前（文字と同じなら省ける）。配置は layout で渡す。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  label?: string;
  layout?: Layout;
  children?: ReactNode;
}

export function Checkbox({ checked, onChange, disabled = false, label, layout, children }: Props) {
  return (
    <label className="ui-checkbox" style={layoutStyle(layout)}>
      <input type="checkbox" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
      {children}
    </label>
  );
}
