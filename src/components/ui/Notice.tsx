// 画面の上の通知の帯（段階1）。info は文字の色のまま、warn は注意の黄、error は失敗の赤。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  tone: 'info' | 'warn' | 'error';
  layout?: Layout;
  children: ReactNode;
}

export function Notice({ tone, layout, children }: Props) {
  const cls = tone === 'info' ? 'ui-notice' : `ui-notice ui-notice--${tone}`;
  return <div className={cls} style={layoutStyle(layout)}>{children}</div>;
}
