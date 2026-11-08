// 自社オフィスの社員の位置と当たり判定。描く位置（Scene.ts）と同じ計算を使い、ツールチップと押したときの処理の両方で使う。
// 席の社員は机の1マス下、歩き回る社員は今いる位置に、16×24 px のスプライトとして描く。

// 社員のスプライトの大きさ（マップの座標。画面の拡大率では割らない）
export const STAFF_W = 16;
export const STAFF_H = 24;
// 社員のコマ送りの間隔（ms）。ART.md の 4〜8 fps 相当。打鍵の揺れは2コマで1周期。
export const STAFF_FRAME_MS = 150;

// 席の社員の上端。机のマス（dx, dy）の1マス下。tap は打鍵の揺れ（0 か 1）
export const deskStaffPos = (dx: number, dy: number, ts: number, tap: number): { x: number; y: number } => ({
  x: dx * ts + (ts - STAFF_W) / 2,
  y: (dy + 1) * ts - 6 - tap,
});

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
