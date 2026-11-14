// 通常のボタン。種類（primary・secondary・danger）と大きさ（s・m・l）で見た目が決まる（ui.css の ui-button）。配置は layout で渡す。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger';
export type ButtonSize = 's' | 'm' | 'l';

interface Props {
  variant: ButtonVariant;
  size?: ButtonSize;
  onClick: () => void;
  disabled?: boolean;
  layout?: Layout;
  children: ReactNode;
}

export function Button({ variant, size = 'm', onClick, disabled = false, layout, children }: Props) {
  return (
    <button type="button" className={`ui-button ui-button--${variant} ui-button--${size}`} disabled={disabled} onClick={onClick} style={layoutStyle(layout)}>
      {children}
    </button>
  );
}
