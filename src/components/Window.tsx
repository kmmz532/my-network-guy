// 動かせるウィンドウの部品。上端の帯をドラッグして移動し、右下の角をドラッグして大きさを変える。
// 位置と大きさの計算は ui/windows.ts が受け持ち、ここはポインターの処理と見た目だけを扱う（マウス・タッチ・ペンは同じ処理）。
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { Edges, Rect } from '../ui/windows';
import { Window as UiWindow } from './ui/Window';

interface Props {
  title: ReactNode;
  rect: Rect;
  // false のときは、帯と角で動かさない（狭い画面）
  movable: boolean;
  closeLabel: string;
  // 閉じるボタンの文字（指定がなければ ×。スマホのパネルは「戻る」）
  closeText?: string;
  onFocus: () => void;
  onMove: (x: number, y: number) => void;
  // 辺や角をドラッグしたとき。動かした辺・移動量・開始時の位置と大きさを渡す（計算は ui/windows.ts の resizeRect）
  onResize: (edges: Edges, dx: number, dy: number, start: Rect) => void;
  onClose: () => void;
  // タイトルの帯の下に出すタブの帯（タブが1つのときは null）
  tabs?: ReactNode;
  // 中身（TabbedBody）がスクロールを持つ（ui/Window.tsx の scroll）
  scroll?: 'inner';
  children: ReactNode;
}

// つかんでいる間の記録（つかんだ位置と、そのときの位置・大きさ）
interface Drag {
  kind: 'move' | 'resize';
  px: number;
  py: number;
  rect: Rect;
  // 大きさを変えるときに動かす辺（移動のときは使わない）
  edges?: Edges;
}

// 大きさを変える判定（N57）。四辺は縁から内側 6 px、四隅は 12 px 四方。帯の上辺も大きさを変える（移動は帯の内側）
const EDGE_PX = 6;
const CORNER_PX = 12;
const RESIZE_HANDLES: { name: string; edges: Edges; cursor: string; style: CSSProperties }[] = [
  { name: 'n', edges: { n: true }, cursor: 'ns-resize', style: { top: 0, left: CORNER_PX, right: CORNER_PX, height: EDGE_PX } },
  { name: 's', edges: { s: true }, cursor: 'ns-resize', style: { bottom: 0, left: CORNER_PX, right: CORNER_PX, height: EDGE_PX } },
  { name: 'e', edges: { e: true }, cursor: 'ew-resize', style: { right: 0, top: CORNER_PX, bottom: CORNER_PX, width: EDGE_PX } },
  { name: 'w', edges: { w: true }, cursor: 'ew-resize', style: { left: 0, top: CORNER_PX, bottom: CORNER_PX, width: EDGE_PX } },
  { name: 'nw', edges: { n: true, w: true }, cursor: 'nwse-resize', style: { top: 0, left: 0, width: CORNER_PX, height: CORNER_PX } },
  { name: 'ne', edges: { n: true, e: true }, cursor: 'nesw-resize', style: { top: 0, right: 0, width: CORNER_PX, height: CORNER_PX } },
  { name: 'se', edges: { s: true, e: true }, cursor: 'nwse-resize', style: { bottom: 0, right: 0, width: CORNER_PX, height: CORNER_PX } },
  { name: 'sw', edges: { s: true, w: true }, cursor: 'nesw-resize', style: { bottom: 0, left: 0, width: CORNER_PX, height: CORNER_PX } },
];

export function Window({ title, rect, movable, closeLabel, closeText, onFocus, onMove, onResize, onClose, tabs, scroll, children }: Props) {
  const drag = useRef<Drag | null>(null);

  // 押したら、そのウィンドウを手前に出し、つかんだ位置を覚える。左ボタン以外のマウスは無視する
  const begin = (kind: Drag['kind'], edges?: Edges) => (e: PointerEvent<HTMLElement>) => {
    if (!movable) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { kind, px: e.clientX, py: e.clientY, rect, edges };
  };

  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.px;
    const dy = e.clientY - d.py;
    if (d.kind === 'move') onMove(d.rect.x + dx, d.rect.y + dy);
    else onResize(d.edges ?? { e: true, s: true }, dx, dy, d.rect);
  };

  const end = (e: PointerEvent<HTMLElement>) => {
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  return (
    <UiWindow
      title={title}
      closeLabel={closeLabel}
      closeText={closeText}
      onClose={onClose}
      rect={rect}
      movable={movable}
      tabs={tabs}
      scroll={scroll}
      frameProps={{
        onPointerDownCapture: onFocus,
        // 中ボタンの既定の動き（自動スクロール）を止める
        onMouseDown: (e) => {
          if (e.button === 1) e.preventDefault();
        },
      }}
      barProps={{
        onPointerDown: begin('move'),
        onPointerMove: move,
        onPointerUp: end,
        onPointerCancel: end,
        // 帯を中ボタンで押すと、ウィンドウごと閉じる
        onAuxClick: (e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          onClose();
        },
      }}
      handles={
        movable &&
        RESIZE_HANDLES.map((h) => (
          <div
            key={h.name}
            onPointerDown={begin('resize', h.edges)}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
            aria-hidden="true"
            style={{ position: 'absolute', zIndex: 2, touchAction: 'none', cursor: h.cursor, ...h.style }}
          />
        ))
      }
    >
      {children}
    </UiWindow>
  );
}
