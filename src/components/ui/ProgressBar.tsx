// 進みの棒。fraction（0〜1）の分だけ色を塗る。色は color で受け取る（既定は主な強調の色）。
// size: m は経験値の棒（細い枠なし）、s は社員の訓練の棒（枠つき）。子は棒の上に重ねて置ける（位置は棒の基準）。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  fraction: number;
  color?: string;
  size: 'm' | 's';
  layout?: Layout;
  children?: ReactNode;
}

export function ProgressBar({ fraction, color = 'var(--accent)', size, layout, children }: Props) {
  return (
    <div className={`ui-progress ui-progress--${size}`} style={layoutStyle(layout)}>
      <span className="ui-progress__fill" style={{ width: `${fraction * 100}%`, background: color }} />
      {children}
    </div>
  );
}
