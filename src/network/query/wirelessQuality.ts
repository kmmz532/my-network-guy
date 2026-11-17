import type { NetworkState } from '../engine/state';
import { accessPointsOf, wirelessAssociations } from '../engine/stages/links';
import { getComponent } from '../components';
import { interferenceRadius } from '../../registry/wireless';
import { bandOf } from '../wirelessBand';
import { channelOverlapsOf } from './channelOverlaps';

// 干渉源（電子レンジなど）の半径の中にある、2.4GHz のアクセスポイント。5GHz は影響しない。SSID のないものは電波を出さないため数えない
export const interferedAccessPointsOf = (state: NetworkState): Set<string> => {
  const radius = interferenceRadius();
  const out = new Set<string>();
  for (const ap of accessPointsOf(state.input, state.world)) {
    if (getComponent(ap, 'wireless')?.ssid === undefined || bandOf(ap) !== '2.4') continue;
    if (state.world.interferers.some((s) => Math.abs(s.x - ap.x) + Math.abs(s.y - ap.y) <= radius)) out.add(ap.uid);
  }
  return out;
};

export type WirelessQuality = 'good' | 'fair' | 'poor';

// 無線の端末の通信の品質。つながったアクセスポイントが、チャネルの重なりと干渉源のどちらかに当たれば可、両方なら不可、なければ良。つながっていなければ null
export const wirelessQualityOf = (state: NetworkState, clientUid: string): WirelessQuality | null => {
  const pair = wirelessAssociations(state.input, state.world).find((p) => p.client.uid === clientUid);
  if (pair === undefined) return null;
  const overlapped = channelOverlapsOf(state).some((o) => o.a === pair.ap.uid || o.b === pair.ap.uid);
  const interfered = interferedAccessPointsOf(state).has(pair.ap.uid);
  return overlapped && interfered ? 'poor' : overlapped || interfered ? 'fair' : 'good';
};
