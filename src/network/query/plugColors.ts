// 差してあるプラグに描く色の帯（背面・口の一覧）。ケーブルが表すネットワークの色を3つまで、ネットワークがなければケーブルの色
import type { NetworkState } from '../engine/state';
import { colorOfLink, colorOfNetwork, networksOfLink } from '../netColor';
import { networkColors } from './networkColors';

export const plugColorsOf = (state: NetworkState, linkUid: string): number[] => {
  const colors = networkColors(state);
  const nets = networksOfLink(colors, linkUid).slice(0, 3);
  return nets.length > 0 ? nets.map((n) => colorOfNetwork(colors, n) ?? colorOfLink(colors, linkUid)) : [colorOfLink(colors, linkUid)];
};
