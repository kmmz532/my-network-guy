// 本文・補足・状態の文。地は持たず、文字の色と大きさを tone と size で決める。周りの文字の色は継承しない。
// tone: sub は補足（今の 0.7 の淡さ）、ok は成功、warn は注意、error は未設定・失敗。size は今の値を持つ（11・12・13・14・16 px）。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export type TextTone = 'normal' | 'sub' | 'ok' | 'warn' | 'error';
export type TextSize = 'xs' | 's' | 'sm' | 'm' | 'l';

interface Props {
  tone?: TextTone;
  size?: TextSize;
  bold?: boolean;
  // 文中に入れる場合は span、段として置く場合は div（既定）
  as?: 'div' | 'span';
  layout?: Layout;
  children: ReactNode;
}

export function Text({ tone = 'normal', size = 'm', bold = false, as = 'div', layout, children }: Props) {
  const Tag = as;
  const cls = ['ui-text', `ui-text--${tone}`, `ui-text--${size}`, bold && 'ui-text--bold'].filter(Boolean).join(' ');
  return <Tag className={cls} style={layoutStyle(layout)}>{children}</Tag>;
}
