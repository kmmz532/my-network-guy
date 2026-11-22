// 自社オフィスの社員の位置と当たり判定。描く位置（Scene.ts）と同じ計算を使い、ツールチップと押したときの処理の両方で使う。
// 席の社員は椅子のマス（机のマスの背中側。向きによる）に、歩き回る社員は今いる位置に、16×24 px のスプライトとして描く。
import { chairTileOf, type Facing } from '../sim/facing';

// 社員のスプライトの大きさ（マップの座標。画面の拡大率では割らない）
export const STAFF_W = 16;
export const STAFF_H = 24;
// 社員のコマ送りの間隔（ms）。ART.md の 4〜8 fps 相当。打鍵の揺れは2コマで1周期。
export const STAFF_FRAME_MS = 150;

// 椅子の絵の上端の位置（マスの下端からの inset）と、足元の inset。描く順（zIndex）は足元の位置で決める
const CHAIR_TOP_INSET = 4;
const FOOT_INSET = 4;

// 椅子の描く順。机のマス（x, y）の背中側のマスの、足元の位置
export const chairDepth = (x: number, y: number, facing: Facing, ts: number): number => {
  const c = chairTileOf(x, y, facing);
  return (c.y + 1) * ts - FOOT_INSET;
};

// 椅子の絵の上端（描く位置）。椅子の絵は、机の背中側のマスの上端に描く
export const chairTop = (x: number, y: number, facing: Facing, ts: number): { x: number; y: number } => {
  const c = chairTileOf(x, y, facing);
  return { x: c.x * ts, y: c.y * ts - CHAIR_TOP_INSET };
};

// 席の社員の上端。椅子のマス（机の背中側。向きによる）の、社員のスプライトの位置。tap は打鍵の揺れ（0 か 1）
export const deskStaffPos = (dx: number, dy: number, ts: number, tap: number, facing: Facing): { x: number; y: number } => {
  const c = chairTileOf(dx, dy, facing);
  return { x: c.x * ts + (ts - STAFF_W) / 2, y: c.y * ts - 6 - tap };
};

// 席の社員の描く順。社員は椅子と同じ列の中で、椅子との前後を決める: 手前の椅子（up）は社員の後ろ、奥の椅子（down）は社員の手前、横の椅子はその間
export const deskStaffDepth = (dx: number, dy: number, ts: number, facing: Facing): number => {
  const shift = facing === 'up' ? -1 : facing === 'down' ? 1 : -0.5;
  return chairDepth(dx, dy, facing, ts) + shift;
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
