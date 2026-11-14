// 吹き出し・選択の一覧の箱。menu は窓と同じ段階1の箱（選択の一覧・口のメニュー）、tip は紙の色の吹き出し（段階3）。位置は layout で渡す。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  variant: 'menu' | 'tip';
  layout?: Layout;
  children: ReactNode;
}

export function Popover({ variant, layout, children }: Props) {
  return <div className={`ui-popover--${variant}`} style={layoutStyle(layout)}>{children}</div>;
}
