// 無線の帯ごとの数値（balance.json の wireless）を引く小さな問い合わせ。
import { balance } from 'virtual:game-data';
import type { WirelessBand } from '../data/schema';
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

// 機器が選べる帯。無線の対応（wlan）を持たない機器は例外
export const deviceBands = (device: string): readonly WirelessBand[] => {
  const wlan = deviceDef(device).wlan;
  if (wlan === undefined) throw new Error(`機器 ${device} は無線の対応（wlan）を持たない`);
  return wlan.bands;
};
