// 札（段階2）。窓の中で、複数の行と操作を1つにまとめる単位。地と文字は札が決める。配置は layout で渡す。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  layout?: Layout;
  children: ReactNode;
}

export function Card({ layout, children }: Props) {
  return <div className="ui-card" style={layoutStyle(layout)}>{children}</div>;
}
