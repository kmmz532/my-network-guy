// 札（小さい枠の印）。文字と枠は color で受け取る（職種の色など）。地は段階3と同じ紺の暗い地に固定する。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  color: string;
  layout?: Layout;
  children: ReactNode;
}

export function Badge({ color, layout, children }: Props) {
  return <span className="ui-badge" style={{ ...layoutStyle(layout), color, borderColor: color }}>{children}</span>;
}
