// 無線の帯ごとの数値（balance.json の wireless）を引く小さな問い合わせ。
import { balance } from 'virtual:game-data';
import type { WirelessBand } from '../data/schema';
import type { WirelessSecurity } from '../network/types';
import { deviceDef } from './query';

type BandBalance = (typeof balance.wireless.bands)[WirelessBand];

const bandBalance = (band: WirelessBand): BandBalance => balance.wireless.bands[band];

// 電波の届く半径（マス）
export const bandRadius = (band: WirelessBand): number => bandBalance(band).radius;

// 壁1マスを通るごとに失われる、届く距離（マス）
export const bandWallLoss = (band: WirelessBand): number => bandBalance(band).wallLoss;

// 帯で選べるチャネル（小さい順）
export const bandChannels = (band: WirelessBand): number[] =>
  bandBalance(band).channels.flatMap((r) => {
    const out: number[] = [];
    for (let c = r.from; c <= r.to; c += r.step) out.push(c);
    return out;
  });

// チャネルを設定していないアクセスポイントのチャネル
export const bandDefaultChannel = (band: WirelessBand): number => bandBalance(band).defaultChannel;

// 同じ帯の2つのチャネルが重なるか
export const channelsOverlap = (band: WirelessBand, a: number, b: number): boolean => Math.abs(a - b) <= bandBalance(band).overlapDiff;

// 干渉源の家具（電子レンジなど）か
export const isInterferenceSource = (furnitureId: string): boolean => balance.wireless.interference.sources.includes(furnitureId);

// 干渉源から 2.4GHz のアクセスポイントまで、干渉の届く半径（マス）
export const interferenceRadius = (): number => balance.wireless.interference.radius;

// 機器の無線の対応（wlan）。無線の対応を持たない機器は例外
const wlanOf = (device: string) => {
  const wlan = deviceDef(device).wlan;
  if (wlan === undefined) throw new Error(`機器 ${device} は無線の対応（wlan）を持たない`);
  return wlan;
};

// 機器が選べる帯（端末なら対応する帯）
export const deviceBands = (device: string): readonly WirelessBand[] => wlanOf(device).bands;

// 端末が、SSID の暗号化の方式につながれるか。WPA2/WPA3 の移行モード（wpa2wpa3）は、WPA2 か WPA3 のどちらかに対応すればつながる
export const securitySupported = (device: string, security: WirelessSecurity): boolean => {
  const supported: readonly WirelessSecurity[] = wlanOf(device).security;
  return security === 'wpa2wpa3' ? supported.includes('wpa2') || supported.includes('wpa3') : supported.includes(security);
};
