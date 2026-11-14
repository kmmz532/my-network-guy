// 通常のボタン。種類（primary・secondary・danger・outline）と大きさ（s・m・l・fit・choice・menu）で見た目が決まる（ui.css の ui-button）。配置は layout で渡す。
// pressed は選択中の表示（aria-pressed）。secondary は黄の地、outline は反転になる。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline';
export type ButtonSize = 's' | 'm' | 'l' | 'fit' | 'choice' | 'menu';

interface Props {
  variant: ButtonVariant;
  size?: ButtonSize;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  title?: string;
  type?: 'button' | 'submit';
  label?: string;
  layout?: Layout;
  children: ReactNode;
}

export function Button({ variant, size = 'm', onClick, disabled = false, pressed, title, type = 'button', label, layout, children }: Props) {
  return (
    <button
      type={type}
      className={`ui-button ui-button--${variant} ui-button--${size}`}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      title={title}
      onClick={onClick}
      style={layoutStyle(layout)}
    >
      {children}
    </button>
  );
}
