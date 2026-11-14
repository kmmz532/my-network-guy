// 正方形の札（持ち物・解放される物の絵）。右下に数を出せる。絵は子で渡す。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  count?: number;
  layout?: Layout;
  children: ReactNode;
}

export function Tile({ count, layout, children }: Props) {
  return (
    <div className="ui-tile" style={layoutStyle(layout)}>
      {children}
      {count !== undefined && <span className="ui-tile__count">{count}</span>}
    </div>
  );
}
