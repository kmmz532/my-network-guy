// 窓の中の区切り（段階1の中の段）。下に区切りの線を引く。edge が top のときは余白なしで上に線を引く（並んだ行の間）。dim は今は使えない段（薄く出す）。中身は子が決める。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  edge?: 'bottom' | 'top';
  dim?: boolean;
  layout?: Layout;
  children: ReactNode;
}

export function Section({ edge = 'bottom', dim = false, layout, children }: Props) {
  return <div className={`ui-section${edge === 'top' ? ' ui-section--top' : ''}${dim ? ' ui-section--dim' : ''}`} style={layoutStyle(layout)}>{children}</div>;
}
