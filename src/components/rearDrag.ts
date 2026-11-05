// 背面タブのドラッグ（刺さったプラグを、同じ背面の空きポートへ挿し替える）の判定。
// DOM には触れず、ポートの位置（画面の座標）と離した位置だけから決める。

// これ未満の動きは「押した」とみなし、ドラッグにしない（外す・挿し替えの選択を出す）
export const DRAG_THRESHOLD_PX = 4;

// ポートの枠（画面の座標。right・bottom は含まない）
export interface PortBox {
  port: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// 押した位置から現在の位置までの距離が、しきい値以上か
export const isDragMove = (startX: number, startY: number, x: number, y: number): boolean =>
  Math.hypot(x - startX, y - startY) >= DRAG_THRESHOLD_PX;

// 点の上にあるポートの状態。空いていれば 'free'、埋まっていれば 'used'、どのポートの上でもなければ null
export type PortHover = { port: number; state: 'free' | 'used' } | null;

export const portHoverAt = (x: number, y: number, boxes: readonly PortBox[], isUsed: (port: number) => boolean): PortHover => {
  const hit = boxes.find((b) => x >= b.left && x < b.right && y >= b.top && y < b.bottom);
  if (!hit) return null;
  return { port: hit.port, state: isUsed(hit.port) ? 'used' : 'free' };
};

// 離した位置から挿し替え先を決める。空いているポートの上でだけ挿し替え先になる（埋まったポートや枠の外は null）
export const replugTargetAt = (x: number, y: number, boxes: readonly PortBox[], isUsed: (port: number) => boolean): number | null => {
  const hover = portHoverAt(x, y, boxes, isUsed);
  return hover?.state === 'free' ? hover.port : null;
};
