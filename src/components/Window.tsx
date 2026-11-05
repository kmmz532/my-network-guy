// 動かせるウィンドウの部品。上端の帯をドラッグして移動し、右下の角をドラッグして大きさを変える。
// 位置と大きさの計算は ui/windows.ts が受け持ち、ここはポインターの処理と見た目だけを扱う（マウス・タッチ・ペンは同じ処理）。
import { useRef, type PointerEvent, type ReactNode } from 'react';
import type { Rect } from '../ui/windows';

interface Props {
  title: ReactNode;
  rect: Rect;
  // false のときは、帯と角で動かさない（狭い画面）
  movable: boolean;
  closeLabel: string;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onClose: () => void;
  children: ReactNode;
}

// つかんでいる間の記録（つかんだ位置と、そのときの位置・大きさ）
interface Drag {
  kind: 'move' | 'resize';
  px: number;
  py: number;
  rect: Rect;
}

const frame = {
  position: 'absolute',
  zIndex: 4,
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  background: 'rgba(47, 79, 143, 0.95)',
  color: '#f4f1e6',
  border: '1px solid #3b2a33',
  borderRadius: 4,
  fontSize: 13,
  overflow: 'hidden',
} as const;

export function Window({ title, rect, movable, closeLabel, onFocus, onMove, onResize, onClose, children }: Props) {
  const drag = useRef<Drag | null>(null);

  // 押したら、そのウィンドウを手前に出し、つかんだ位置を覚える。左ボタン以外のマウスは無視する
  const begin = (kind: Drag['kind']) => (e: PointerEvent<HTMLElement>) => {
    if (!movable) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, px: e.clientX, py: e.clientY, rect };
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (d.kind === 'move') onMove(d.rect.x + dx, d.rect.y + dy);
    else onResize(d.rect.w + dx, d.rect.h + dy);
  };

  const end = (e: PointerEvent<HTMLElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <div
      role="dialog"
      onPointerDownCapture={onFocus}
      style={{ ...frame, left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: '4px 6px',
          flexShrink: 0,
          background: '#25406f',
          borderBottom: '1px solid #3b2a33',
          cursor: movable ? 'move' : 'default',
          touchAction: 'none',
          userSelect: 'none',
        }}
      >
        {/* 文字と余白は UI の大きさの倍率を受ける（枠の大きさは、動かしたり大きさを変えたりした値のまま） */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, minWidth: 0, width: '100%', zoom: 'var(--ui-scale, 1)' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, overflow: 'hidden', whiteSpace: 'nowrap' }}>{title}</span>
          <button
            aria-label={closeLabel}
            // 帯の移動を始めないよう、押した位置の処理を止める（止めないと、ボタンの上で移動が始まる）
            onPointerDown={(e) => e.stopPropagation()}
            onClick={onClose}
            style={{ flexShrink: 0, width: 22, height: 22, padding: 0, cursor: 'pointer', background: '#25406f', color: '#f4f1e6', border: '1px solid #3b2a33', borderRadius: 3, lineHeight: '20px' }}
          >
            ×
          </button>
        </div>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
        <div style={{ width: '100%', zoom: 'var(--ui-scale, 1)' }}>{children}</div>
      </div>
      {movable && (
        <div
          onPointerDown={begin('resize')}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 16,
            height: 16,
            cursor: 'nwse-resize',
            touchAction: 'none',
            background: 'linear-gradient(135deg, transparent 0 50%, #b8bfcc 50% 58%, transparent 58% 74%, #b8bfcc 74% 82%, transparent 82%)',
          }}
        />
      )}
    </div>
  );
}
