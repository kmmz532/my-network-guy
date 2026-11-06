// 動かせるウィンドウの部品。上端の帯をドラッグして移動し、右下の角をドラッグして大きさを変える。
// 位置と大きさの計算は ui/windows.ts が受け持ち、ここはポインターの処理と見た目だけを扱う（マウス・タッチ・ペンは同じ処理）。
import { useRef, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import type { Edges, Rect } from '../ui/windows';
import { RADIUS, WINDOW_BAR_HEIGHT, uiScaled } from '../ui/theme';

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

const frame = {
  position: 'absolute',
  zIndex: 4,
  display: 'flex',
  flexDirection: 'column',
  boxSizing: 'border-box',
  background: 'rgba(47, 79, 143, 0.95)',
  color: '#f4f1e6',
  border: '1px solid #3b2a33',
  borderRadius: RADIUS.chrome,
  fontSize: 13,
  overflow: 'hidden',
} as const;

export function Window({ title, rect, movable, closeLabel, closeText, onFocus, onMove, onResize, onClose, tabs, children }: Props) {
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
    <div
      role="dialog"
      onPointerDownCapture={onFocus}
      // 中ボタンの既定の動き（自動スクロール）を止める
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      style={{ ...frame, left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
    >
      <div
        onPointerDown={begin('move')}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        // 帯を中ボタンで押すと、ウィンドウごと閉じる
        onAuxClick={(e) => {
          if (e.button !== 1) return;
          e.preventDefault();
          onClose();
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          // 高さは固定する（中身の絵や文字の大きさで帯が高くならないように、はみ出しは切る）
          height: uiScaled(WINDOW_BAR_HEIGHT),
          boxSizing: 'border-box',
          overflow: 'hidden',
          padding: '0 6px',
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
            style={{ position: 'relative', zIndex: 1, flexShrink: 0, width: closeText ? 'auto' : 22, minWidth: 22, height: 22, padding: closeText ? '0 8px' : 0, cursor: 'pointer', background: '#25406f', color: '#f4f1e6', border: '1px solid #3b2a33', borderRadius: RADIUS.none, lineHeight: '20px' }}
          >
            {closeText ?? '×'}
          </button>
        </div>
      </div>
      {tabs}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 8 }}>
        {/* 中身はウィンドウの高さいっぱいまで伸ばせる（インベントリの枠など）。zoom を掛けるため、高さは倍率で割る */}
        <div style={{ width: '100%', minHeight: 'calc(100% / var(--ui-scale, 1))', display: 'flex', flexDirection: 'column', zoom: 'var(--ui-scale, 1)' }}>{children}</div>
      </div>
      {movable && RESIZE_HANDLES.map((h) => (
        <div
          key={h.name}
          onPointerDown={begin('resize', h.edges)}
          onPointerMove={move}
          onPointerUp={end}
          onPointerCancel={end}
          aria-hidden="true"
          style={{ position: 'absolute', zIndex: 2, touchAction: 'none', cursor: h.cursor, ...h.style }}
        />
      ))}
      {movable && (
        // 右下の取っ手は大きさを変えられることの目印（動きは右下の角の判定が受け持つ）
        <div
          aria-hidden="true"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 16,
            height: 16,
            pointerEvents: 'none',
            background: 'linear-gradient(135deg, transparent 0 50%, #b8bfcc 50% 58%, transparent 58% 74%, #b8bfcc 74% 82%, transparent 82%)',
          }}
        />
      )}
    </div>
  );
}
