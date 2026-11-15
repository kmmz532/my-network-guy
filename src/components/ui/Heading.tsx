// 題。screen は全画面の知らせの題（さらに大きい字）、window は窓の題（大きい字）、section は段の題（本文の大きさの太字）。地は持たない。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  level: 'screen' | 'window' | 'section';
  layout?: Layout;
  children: ReactNode;
}

export function Heading({ level, layout, children }: Props) {
  return (
    <div className={`ui-heading ui-heading--${level}`} role={level === 'screen' ? 'heading' : undefined} aria-level={level === 'screen' ? 2 : undefined} style={layoutStyle(layout)}>
      {children}
    </div>
  );
}
