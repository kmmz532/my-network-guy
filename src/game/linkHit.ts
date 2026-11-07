// 配線の上の点の判定（右クリックで配線を撤去する・マウスを乗せて強調する・ケーブルの端をつかんで挿し替える）。
// 座標はマップの座標（px）で、path は配線の折れ線（マス単位の点列）。
// 配線は機器の中心（マスの中央）を通るため、判定でも中央に合わせる。
import type { NetLink } from '../network/types';
import { cumulativeLengths, pointAt, type Point } from './animation';

// 画面上で判定する距離（px）。マップの拡大率で割って、マップの座標の距離に直す
export const CABLE_HIT_SCREEN_PX = 8;

// 点から線分までの距離
const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// 点から折れ線までの距離（点と折れ線は同じ座標系にある）
export const distanceToPath = (px: number, py: number, path: readonly (readonly [number, number])[]): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    best = Math.min(best, distanceToSegment(px, py, ax, ay, bx, by));
  }
  return best;
};

// マス単位の折れ線を、マップの座標（px）の折れ線に直す（マスの中央を通る）
export const centerPath = (path: readonly (readonly [number, number])[], tileSize: number): [number, number][] =>
  path.map(([x, y]) => [x * tileSize + tileSize / 2, y * tileSize + tileSize / 2]);

// マップの座標（px）の点の近くにある配線。画面上で maxScreenPx 以内（拡大率で換算）のうち最も近いものを返す
export const linkAt = (
  links: readonly NetLink[],
  px: number,
  py: number,
  tileSize: number,
  scale: number,
  maxScreenPx: number = CABLE_HIT_SCREEN_PX,
): NetLink | undefined => {
  const limit = maxScreenPx / scale;
  let found: NetLink | undefined;
  let best = Infinity;
  for (const link of links) {
    const d = distanceToPath(px, py, centerPath(link.path, tileSize));
    if (d <= limit && d < best) {
      best = d;
      found = link;
    }
  }
  return found;
};

// ケーブルの端（差し込み口）をつかめる距離（画面上の px）
export const CABLE_END_SCREEN_PX = 12;

// ケーブルの端の位置（マップの座標）。機器の中心から1マス先の点で、ポートの名前を出す位置と同じ
export const plugPoints = (link: NetLink, tileSize: number): { a: Point; b: Point } => {
  const pts: Point[] = centerPath(link.path, tileSize).map(([x, y]) => ({ x, y }));
  const reversed = [...pts].reverse();
  return {
    a: pointAt(pts, cumulativeLengths(pts), tileSize),
    b: pointAt(reversed, cumulativeLengths(reversed), tileSize),
  };
};

// 押した位置の近くにあるケーブルの端。画面上で maxScreenPx 以内（拡大率で換算）のうち最も近いものを返す
export const cableEndAt = (
  links: readonly NetLink[],
  px: number,
  py: number,
  tileSize: number,
  scale: number,
  maxScreenPx: number = CABLE_END_SCREEN_PX,
): { linkUid: string; end: 'a' | 'b' } | undefined => {
  const limit = maxScreenPx / scale;
  let found: { linkUid: string; end: 'a' | 'b' } | undefined;
  let best = limit;
  for (const link of links) {
    const plugs = plugPoints(link, tileSize);
    for (const end of ['a', 'b'] as const) {
      const d = Math.hypot(px - plugs[end].x, py - plugs[end].y);
      if (d <= best) {
        best = d;
        found = { linkUid: link.uid, end };
      }
    }
  }
  return found;
};

// 押したときに、ケーブルの端をつかむか（N107）。配線の道具では、押した位置に機器があれば機器を優先して新しいケーブルを引く。
// 選択の道具は、今のとおりケーブルの端を先につかむ（挿し替えは選択の道具の操作）
export const grabsCableEnd = (tool: 'select' | 'wire', hasNodeAtPress: boolean): boolean => !(tool === 'wire' && hasNodeAtPress);
