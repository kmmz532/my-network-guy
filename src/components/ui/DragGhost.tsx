// ドラッグ中の品目の絵。ポインターの位置（left・top）に付いて動き、操作を受けない。少し透かして出す。
import type { ReactNode } from 'react';
import './tokens.css';
import './ui.css';

export function DragGhost({ left, top, children }: { left: number; top: number; children: ReactNode }) {
  return (
    <div className="ui-drag-ghost" style={{ left, top }}>
      {children}
    </div>
  );
}
