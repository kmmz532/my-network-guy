// 絵だけのボタン。label は必須で、aria-label と吹き出しになる。吹き出しに押すキーなどを足すときは tip で渡す。guide は案内（data-guide）の目印。
// selected は今の道具（押し込んだ見た目）、count は右上の数の札。
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
  tip?: string;
  guide?: string;
  disabled?: boolean;
  layout?: Layout;
  children: ReactNode;
}

export function IconButton({ variant = 'normal', label, onClick, selected = false, count, tip, guide, disabled = false, layout, children }: Props) {
  const cls = `ui-icon-button ui-icon-button--${variant}${selected ? ' ui-icon-button--selected' : ''}`;
  return (
    <Tooltip text={tip ?? label}>
      <button type="button" aria-label={label} className={cls} disabled={disabled} data-guide={guide} onClick={onClick} style={layoutStyle(layout)}>
        {children}
        {count !== undefined && count > 0 && <span className="ui-icon-button__count">{count}</span>}
      </button>
    </Tooltip>
  );
}
