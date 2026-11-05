// 配線の上の点の判定（右クリックで配線を撤去するときに使う）。座標はマス単位、path は折れ線の点列
import type { NetLink } from '../network/types';

// 点から線分までの距離
const distanceToSegment = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  const t = lenSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lenSq));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

// 点から折れ線までの距離
export const distanceToPath = (px: number, py: number, path: readonly (readonly [number, number])[]): number => {
  let best = Infinity;
  for (let i = 0; i + 1 < path.length; i++) {
    const [ax, ay] = path[i];
    const [bx, by] = path[i + 1];
    best = Math.min(best, distanceToSegment(px, py, ax, ay, bx, by));
  }
  return best;
};

// 点（マス単位）の近くにある配線。threshold 以内で最も近いものを返す
export const linkAt = (links: readonly NetLink[], tx: number, ty: number, threshold: number): NetLink | undefined => {
  let found: NetLink | undefined;
  let best = threshold;
  for (const link of links) {
    const d = distanceToPath(tx, ty, link.path);
    if (d <= best) {
      best = d;
      found = link;
    }
  }
  return found;
};
