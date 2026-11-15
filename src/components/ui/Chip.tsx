// 絵と名前を横に並べた小さな札（解放された機器・家具の一覧）。地は札と同じ紺で、細い枠を持つ。nowrap は名前を折り返さない。
import type { ReactNode } from 'react';
import './tokens.css';
import './ui.css';

interface Props {
  nowrap?: boolean;
  children: ReactNode;
}

export function Chip({ nowrap = false, children }: Props) {
  return <div className={`ui-chip${nowrap ? ' ui-chip--nowrap' : ''}`}>{children}</div>;
}
