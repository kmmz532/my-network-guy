// 通常のボタン。種類（primary・secondary・danger・outline・plain）と大きさ（s・m・l・fit・choice・menu・row）で見た目が決まる（ui.css の ui-button）。配置は layout で渡す。
// 文字は折り返さない（row だけ折り返す）。submit のボタンは onClick を省ける。
// pressed は選択中の表示（aria-pressed）。unavailable は押せるが今は効かない印（薄く出す）。bare は余白のない、絵と文字を並べる行。wide は絵と文字を並べる横長のボタン（44 px の高さ）。guide は案内（data-guide）の目印。alert は画面全体を止める知らせの確認（黄の地・枠なし）、debug は開発用の入口（暗い赤の地）、notify は通知の中の操作（青の地・枠なし）。secondary は黄の地、outline は反転になる。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'outline' | 'plain' | 'accent' | 'confirm' | 'alert' | 'debug' | 'notify';
export type ButtonSize = 's' | 'm' | 'l' | 'fit' | 'choice' | 'menu' | 'row' | 'bare' | 'wide' | 'port';

interface Props {
  variant: ButtonVariant;
  size?: ButtonSize;
  onClick?: () => void;
  disabled?: boolean;
  pressed?: boolean;
  unavailable?: boolean;
  guide?: string;
  title?: string;
  type?: 'button' | 'submit';
  label?: string;
  layout?: Layout;
  children: ReactNode;
}

export function Button({ variant, size = 'm', onClick, disabled = false, pressed, unavailable = false, guide, title, type = 'button', label, layout, children }: Props) {
  return (
    <button
      type={type}
      className={`ui-button ui-button--${variant} ui-button--${size}${unavailable ? ' ui-button--unavailable' : ''}`}
      aria-disabled={unavailable || undefined}
      disabled={disabled}
      aria-pressed={pressed}
      aria-label={label}
      data-guide={guide}
      title={title}
      onClick={onClick}
      style={layoutStyle(layout)}
    >
      {children}
    </button>
  );
}
