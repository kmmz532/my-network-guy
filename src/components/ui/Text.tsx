// 本文・補足・状態の文。地は持たず、文字の色と大きさを tone と size で決める。周りの文字の色は継承しない。
// tone: sub は補足（今の 0.7 の淡さ）、soft は本文より少し淡い説明（0.85）、faint は未判定の印（0.25）、halt は停止・分離の橙、note は補足の灰（地の上でも読める明るさ）、ok は成功、warn は注意、error は未設定・失敗、reason は失敗の理由（error より淡い赤）、refusal は戻す・やり直すを断った理由（さらに淡い桃）。size は今の値を持つ（11・12・13・14・16・20 px。xl は報酬の額）。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

export type TextTone = 'normal' | 'sub' | 'soft' | 'faint' | 'ok' | 'warn' | 'error' | 'note' | 'halt' | 'reason' | 'refusal';
export type TextSize = 'xs' | 's' | 'sm' | 'm' | 'l' | 'xl';

interface Props {
  tone?: TextTone;
  size?: TextSize;
  bold?: boolean;
  // 固定幅の文字（ターミナルの入力の前の名前）
  mono?: boolean;
  // 文中に入れる場合は span、段として置く場合は div（既定）
  as?: 'div' | 'span';
  layout?: Layout;
  children: ReactNode;
}

export function Text({ tone = 'normal', size = 'm', bold = false, mono = false, as = 'div', layout, children }: Props) {
  const Tag = as;
  const cls = ['ui-text', `ui-text--${tone}`, `ui-text--${size}`, bold && 'ui-text--bold', mono && 'ui-text--mono'].filter(Boolean).join(' ');
  return <Tag className={cls} style={layoutStyle(layout)}>{children}</Tag>;
}
