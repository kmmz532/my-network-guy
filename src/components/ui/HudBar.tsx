// 画面の上の帯・下のツールバー・ツールバーの上に浮く欄。地と文字の色は variant が決める（top・bottom・tray）。
// as は header・footer・div。arrange は並べ方と位置（flex・padding・position など）で、見た目（色・枠）は渡せない。marker は案内が探す印（data-hud・data-toolbar など）。
import type { CSSProperties, ReactNode, Ref } from 'react';
import './tokens.css';
import './ui.css';

type Arrange = Omit<CSSProperties, 'color' | 'background' | 'backgroundColor' | 'border' | 'boxShadow' | 'opacity' | 'fontSize' | 'fontWeight'>;

interface Props {
  as: 'header' | 'footer' | 'div';
  variant: 'top' | 'bottom' | 'tray';
  arrange: Arrange;
  marker?: string;
  innerRef?: Ref<HTMLElement>;
  children: ReactNode;
}

export function HudBar({ as, variant, arrange, marker, innerRef, children }: Props) {
  const Tag = as as 'div';
  const data = marker ? { [`data-${marker}`]: '' } : {};
  return (
    <Tag ref={innerRef as Ref<HTMLDivElement>} className={`ui-hud-bar ui-hud-bar--${variant}`} style={arrange} {...data}>
      {children}
    </Tag>
  );
}
