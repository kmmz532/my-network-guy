// ツールチップの位置。要素の上側の中央に出し、上にはみ出すときは下側に回す。左右は画面の中に収める（純粋関数）
export interface Anchor {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const placeTip = (
  anchor: Anchor,
  size: { width: number; height: number },
  view: { width: number; height: number },
  gap = 8,
  margin = 4,
): { left: number; top: number } => {
  const centerX = anchor.x + anchor.w / 2;
  let top = anchor.y - size.height - gap;
  if (top < margin) top = anchor.y + anchor.h + gap;
  const maxLeft = view.width - size.width - margin;
  const left = Math.max(margin, Math.min(centerX - size.width / 2, maxLeft));
  return { left, top: Math.max(margin, Math.min(top, view.height - size.height - margin)) };
};
