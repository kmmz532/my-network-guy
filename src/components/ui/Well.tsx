// 窪み（ターミナルの出力と入力、DebugPanel の欄）。地は窪みの色で、文字は明るい色。配置は layout で渡す。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  layout?: Layout;
  children: ReactNode;
}

export function Well({ layout, children }: Props) {
  return <div className="ui-well" style={layoutStyle(layout)}>{children}</div>;
}
