// 自社オフィスの社員の位置と当たり判定。描く位置（Scene.ts）と同じ計算を使い、ツールチップと押したときの処理の両方で使う。
// 席の社員は椅子（机の背中側。向きによる）に、歩き回る社員は今いる位置に、16×24 px のスプライトとして描く。
import type { Facing } from '../sim/facing';

// 社員のスプライトの大きさ（マップの座標。画面の拡大率では割らない）
export const STAFF_W = 16;
export const STAFF_H = 24;
// 社員のコマ送りの間隔（ms）。ART.md の 4〜8 fps 相当。打鍵の揺れは2コマで1周期。
export const STAFF_FRAME_MS = 150;

// 椅子の絵の上端の位置（マスの下端からの inset）と、足元の inset。描く順（zIndex）は足元の位置で決める
const CHAIR_TOP_INSET = 4;
const FOOT_INSET = 4;
// 机の描く順（FurnitureRenderer の机と同じ値）。奥の椅子と席の社員は、これを基準に机の前後を決める
const deskDepth = (y: number, ts: number): number => (y + 1) * ts - FOOT_INSET - 1;
// 横の椅子の、机からの距離（マス単位）。隣のマスより机へ寄せ、椅子の端を机の端に少し重ねる
const SIDE_SHIFT = 0.65;
// 奥の椅子の上端（机のマスの上端から上へ、マス単位）。下半分は机に隠れる
const BACK_RISE = 0.4;
// 横の椅子の上端（机のマスの上端からの差、マス単位）。机の足元より少し奥に置く
const SIDE_DROP = 0;

// 椅子の描く順。手前（up）は机の手前、ほかは机の後ろ
export const chairDepth = (y: number, facing: Facing, ts: number): number => {
  if (facing === 'up') return (y + 2) * ts - FOOT_INSET;
  return deskDepth(y, ts) - 2;
};

// 椅子の絵の上端（描く位置）。手前の椅子は机の1マス下の上端、ほかは机のマスを基準に机へ寄せる
export const chairTop = (x: number, y: number, facing: Facing, ts: number): { x: number; y: number } => {
  if (facing === 'up') return { x: x * ts, y: (y + 1) * ts - CHAIR_TOP_INSET };
  if (facing === 'down') return { x: x * ts, y: y * ts - Math.round(BACK_RISE * ts) };
  const dx = Math.round(SIDE_SHIFT * ts) * (facing === 'left' ? 1 : -1);
  return { x: x * ts + dx, y: y * ts + Math.round(SIDE_DROP * ts) };
};

// 席の社員の上端。椅子に座る位置。tap は打鍵の揺れ（0 か 1）
export const deskStaffPos = (dx: number, dy: number, ts: number, tap: number, facing: Facing): { x: number; y: number } => {
  const chair = chairTop(dx, dy, facing, ts);
  const x = chair.x + (ts - STAFF_W) / 2;
  if (facing === 'up') return { x, y: (dy + 1) * ts - 6 - tap };
  if (facing === 'down') return { x, y: chair.y - 2 - tap };
  return { x, y: chair.y - 8 - tap };
};

// 席の社員の描く順: 手前（up）は椅子の後ろ、ほかは椅子と机の間（机に重なる所は机に隠れる）
export const deskStaffDepth = (dy: number, ts: number, facing: Facing): number => {
  if (facing === 'up') return chairDepth(dy, facing, ts) - 1;
  return deskDepth(dy, ts) - 1;
};

// 席の社員の揺れ（0 か 1）。席の番号 k ごとにずらす
export const deskTap = (elapsed: number, k: number): number => Math.floor(elapsed / (STAFF_FRAME_MS * 2) + k) % 2;

// 歩き回る社員の上端。マスの座標は小数でもよい
export const wanderStaffPos = (x: number, y: number, ts: number): { x: number; y: number } => ({
  x: x * ts + (ts - STAFF_W) / 2,
  y: y * ts + ts - 26,
});

// 描いている社員1人分（社員の uid と、スプライトの左上の位置）
export interface StaffHit {
  uid: string;
  x: number;
  y: number;
}

// 点 p が入っている社員の uid（なければ null）。スプライトの範囲（左上から 16×24）で判定する
export const staffAt = (hits: readonly StaffHit[], p: { x: number; y: number }): string | null => {
  for (const h of hits) {
    if (p.x >= h.x && p.x < h.x + STAFF_W && p.y >= h.y && p.y < h.y + STAFF_H) return h.uid;
  }
  return null;
};
