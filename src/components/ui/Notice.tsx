// 画面の上の通知の帯（段階1）。info は文字の色のまま、warn は注意の黄、error は失敗の赤。banner は止まっている知らせの赤い帯、flash は短く出す表示（速さの変更。窓の地に黄の文字）、card は札の地の帯（操作を中に並べる）。banner・flash は押せない。role は読み上げへの知らせ方。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  tone: 'info' | 'warn' | 'error' | 'banner' | 'flash' | 'card';
  role?: 'alert' | 'status';
  layout?: Layout;
  children: ReactNode;
}

export function Notice({ tone, role, layout, children }: Props) {
  const cls = tone === 'info' ? 'ui-notice' : `ui-notice ui-notice--${tone}`;
  return <div className={cls} role={role} style={layoutStyle(layout)}>{children}</div>;
}
