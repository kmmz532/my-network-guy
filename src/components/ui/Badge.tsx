// 札（小さい枠の印）。文字と枠は color で受け取る（職種の色など）。地は既定で段階3と同じ紺の暗い地に固定する。
// 地・枠・文字を分けるときは fill・border を、文字を小さくするときは size（xs・s）を渡す。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  color: string;
  border?: string;
  fill?: string;
  size?: 'xs' | 's';
  layout?: Layout;
  children: ReactNode;
}

export function Badge({ color, border = color, fill, size = 's', layout, children }: Props) {
  const style = { ...layoutStyle(layout), color, borderColor: border, ...(fill ? { background: fill } : {}) };
  return <span className={`ui-badge ui-badge--${size}`} style={style}>{children}</span>;
}
