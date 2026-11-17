import type { NetworkState } from '../engine/state';
import { accessPointsOf } from '../engine/stages/links';
import { getComponent } from '../components';
import { bandRadius, channelsOverlap } from '../../registry/wireless';
import { bandOf, channelOf } from '../wirelessBand';

// 同じ帯で、チャネルが重なり、電波の範囲が重なるアクセスポイントの組（干渉の警告に使う）。SSID のないものは電波を出さないため数えない。
// 帯が違えば重ならない。チャネルの重なりは帯の規則、範囲は帯の届く半径の2倍以内で判定する
export const channelOverlapsOf = (state: NetworkState): { a: string; b: string }[] => {
  const aps = accessPointsOf(state.input, state.world).filter((ap) => getComponent(ap, 'wireless')?.ssid !== undefined);
  const out: { a: string; b: string }[] = [];
  for (let i = 0; i < aps.length; i++) {
    for (let j = i + 1; j < aps.length; j++) {
      const a = aps[i];
      const b = aps[j];
      const band = bandOf(a);
      if (band !== bandOf(b)) continue;
      if (!channelsOverlap(band, channelOf(a), channelOf(b))) continue;
      if (Math.abs(a.x - b.x) + Math.abs(a.y - b.y) <= bandRadius(band) * 2) out.push({ a: a.uid, b: b.uid });
    }
  }
  return out;
};
