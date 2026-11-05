import { describe, expect, it } from 'vitest';
import type { NetLink } from '../network/types';
import { cableEndAt, plugPoints } from './linkHit';

// 幅 4 マス（タイル 32 px）の水平な配線。機器の中心は (16,16) と (144,16)
const link: NetLink = {
  uid: 'l1',
  cable: 'utp_cat5e',
  a: { node: 'pc_a', port: 0 },
  b: { node: 'u0', port: 0 },
  path: [
    [0, 0],
    [4, 0],
  ],
};

describe('ケーブルの端（差し込み口）', () => {
  it('端の位置は、機器の中心から1マス先の点', () => {
    const plugs = plugPoints(link, 32);
    expect(plugs.a).toEqual({ x: 48, y: 16 });
    expect(plugs.b).toEqual({ x: 112, y: 16 });
  });

  it('端の近く（画面で 12 px 以内）でつかめる。どちらの端かを返す', () => {
    expect(cableEndAt([link], 50, 16, 32, 1)).toEqual({ linkUid: 'l1', end: 'a' });
    expect(cableEndAt([link], 110, 20, 32, 1)).toEqual({ linkUid: 'l1', end: 'b' });
  });

  it('端から離れた線の上では、つかめない（配線の撤去・ホバーの判定に任せる）', () => {
    expect(cableEndAt([link], 80, 16, 32, 1)).toBeUndefined();
  });

  it('拡大率で距離を換算する（拡大すると、マップの座標の距離は小さくなる）', () => {
    // 拡大率 2 では、マップの座標で 6 px 以内
    expect(cableEndAt([link], 54, 16, 32, 2)).toEqual({ linkUid: 'l1', end: 'a' });
    expect(cableEndAt([link], 56, 16, 32, 2)).toBeUndefined();
  });
});
