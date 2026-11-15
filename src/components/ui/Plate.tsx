// 機器の背面の板（暗い灰の地に枠）。中に部品を横に並べる（下端をそろえ、はみ出したら横に送る）。配置は layout で渡す。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  layout?: Layout;
  children: ReactNode;
}

export function Plate({ layout, children }: Props) {
  return <div className="ui-plate" style={layoutStyle(layout)}>{children}</div>;
}
