import type { NetworkState } from '../engine/state';
import { accessPointsOf, WIRELESS_RADIUS } from '../engine/stages/links';

// 同じチャネルで、電波の範囲が重なるアクセスポイントの組（干渉の警告に使う）
export const channelOverlapsOf = (state: NetworkState): { a: string; b: string }[] => {
  const aps = accessPointsOf(state.input, state.world);
  const out: { a: string; b: string }[] = [];
  for (let i = 0; i < aps.length; i++) {
    for (let j = i + 1; j < aps.length; j++) {
      const a = aps[i];
      const b = aps[j];
      if ((a.wireless?.channel ?? 1) !== (b.wireless?.channel ?? 1)) continue;
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= WIRELESS_RADIUS * 2) out.push({ a: a.uid, b: b.uid });
    }
  }
  return out;
};
