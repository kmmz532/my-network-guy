// 窓の中の区切り（段階1の中の段）。下に区切りの線を引く。中身は子が決める。
import type { ReactNode } from 'react';
import { layoutStyle, type Layout } from './layout';
import './tokens.css';
import './ui.css';

interface Props {
  layout?: Layout;
  children: ReactNode;
}

export function Section({ layout, children }: Props) {
  return <div className="ui-section" style={layoutStyle(layout)}>{children}</div>;
}
