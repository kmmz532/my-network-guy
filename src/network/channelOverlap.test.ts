// アクセスポイントのチャネルの重なり（N152）: 同じチャネルで、電波の届く範囲の2倍以内にあるもの
import { describe, expect, it } from 'vitest';
import { channelOverlapsOf } from './query/channelOverlaps';
import { analyze } from './engine/analyze';
import type { EngineData, NetNode, Network } from './types';

const data: EngineData = { wallAt: () => false };
const ap = (uid: string, x: number, channel?: number, band: '2.4' | '5' = '2.4'): NetNode =>
  ({ uid, device: 'access_point', x, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [], components: { wireless: { ssid: 'HOME', password: 'p', band, ...(channel === undefined ? {} : { channel }) } } }) as NetNode;
const net = (nodes: NetNode[]): Network => ({ nodes, links: [], plans: {} });

describe('チャネルの重なり（N152）', () => {
  it('同じチャネルで近いアクセスポイントは重なる', () => {
    expect(channelOverlapsOf(analyze(net([ap('a', 0), ap('b', 5)]), data))).toEqual([{ a: 'a', b: 'b' }]);
  });
  it('2.4GHz は、チャネルの差が4以下なら重なる（1 と 3 は重なり、1 と 6 は重ならない）', () => {
    expect(channelOverlapsOf(analyze(net([ap('a', 0, 1), ap('b', 5, 3)]), data))).toEqual([{ a: 'a', b: 'b' }]);
    expect(channelOverlapsOf(analyze(net([ap('a', 0, 1), ap('b', 5, 6)]), data))).toEqual([]);
  });
  it('5GHz は、同じチャネルだけ重なる', () => {
    expect(channelOverlapsOf(analyze(net([ap('a', 0, 36, '5'), ap('b', 5, 36, '5')]), data))).toEqual([{ a: 'a', b: 'b' }]);
    expect(channelOverlapsOf(analyze(net([ap('a', 0, 36, '5'), ap('b', 5, 40, '5')]), data))).toEqual([]);
  });
  it('帯が違えば、同じ番号でも重ならない', () => {
    expect(channelOverlapsOf(analyze(net([ap('a', 0, 36, '2.4'), ap('b', 5, 36, '5')]), data))).toEqual([]);
  });
  it('遠ければ重ならない（届く範囲の2倍より遠い）', () => {
    expect(channelOverlapsOf(analyze(net([ap('a', 0), ap('b', 17)]), data))).toEqual([]);
  });
  it('SSID のないアクセスポイント（無線を設定していない家庭用ルーターなど）は、近くのアクセスポイントと重ならない', () => {
    const router = { ...ap('r', 3), device: 'home_router', components: {} } as NetNode;
    expect(channelOverlapsOf(analyze(net([ap('a', 0), router]), data))).toEqual([]);
  });
});
