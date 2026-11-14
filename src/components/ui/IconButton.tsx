// 絵だけのボタン。label は必須で、aria-label と吹き出しになる。selected は今の道具・開いている窓、count は右上の数の札。
import type { ReactNode } from 'react';
import { Tooltip } from '../Tooltip';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  variant?: 'normal' | 'primary';
  label: string;
  onClick: () => void;
  selected?: boolean;
  count?: number;
  disabled?: boolean;
  layout?: Layout;
  children: ReactNode;
}

export function IconButton({ variant = 'normal', label, onClick, selected = false, count, disabled = false, layout, children }: Props) {
  const cls = `ui-icon-button ui-icon-button--${variant}${selected ? ' ui-icon-button--selected' : ''}`;
  return (
    <Tooltip text={label}>
      <button type="button" aria-label={label} className={cls} disabled={disabled} onClick={onClick} style={layoutStyle(layout)}>
        {children}
        {count !== undefined && count > 0 && <span className="ui-icon-button__count">{count}</span>}
      </button>
    </Tooltip>
  );
}
