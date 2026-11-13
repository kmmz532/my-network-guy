// アクセスポイントのチャネルの重なり（N152）: 同じチャネルで、電波の届く範囲の2倍以内にあるもの
import { describe, expect, it } from 'vitest';
import { channelOverlapsOf } from './netState';
import type { EngineData, NetNode, Network } from './types';

const data: EngineData = { wallAt: () => false };
const ap = (uid: string, x: number, channel?: number): NetNode =>
  ({ uid, device: 'access_point', x, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [], wireless: { ssid: 'HOME', password: 'p', ...(channel === undefined ? {} : { channel }) } }) as NetNode;
const net = (nodes: NetNode[]): Network => ({ nodes, links: [], segments: {} });

describe('チャネルの重なり（N152）', () => {
  it('同じチャネルで近いアクセスポイントは重なる', () => {
    expect(channelOverlapsOf(net([ap('a', 0), ap('b', 5)]), data)).toEqual([{ a: 'a', b: 'b' }]);
  });
  it('チャネルが違えば重ならない', () => {
    expect(channelOverlapsOf(net([ap('a', 0, 1), ap('b', 5, 6)]), data)).toEqual([]);
  });
  it('遠ければ重ならない（届く範囲の2倍より遠い）', () => {
    expect(channelOverlapsOf(net([ap('a', 0), ap('b', 20)]), data)).toEqual([]);
  });
});
