// アクセスポイントの無線の帯とチャネル。帯のない設定は想定外として例外で止める
import type { WirelessBand } from '../data/schema';
import { bandDefaultChannel } from '../registry/wireless';
import { getComponent } from './components';
import type { NetNode } from './types';

// アクセスポイントの帯
export const bandOf = (ap: NetNode): WirelessBand => {
  const band = getComponent(ap, 'wireless')?.band;
  if (band === undefined) throw new Error(`アクセスポイント ${ap.uid} の無線の設定に帯（band）がない`);
  return band;
};

// アクセスポイントのチャネル（設定がなければ、帯の既定のチャネル）
export const channelOf = (ap: NetNode): number => getComponent(ap, 'wireless')?.channel ?? bandDefaultChannel(bandOf(ap));
