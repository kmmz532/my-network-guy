import { describe, expect, it } from 'vitest';
import { buyDevice, isUnlocked, sellDevice } from './shop';
import { isSaveData, migrate } from '../services/migrations';

describe('ショップ', () => {
  it('会社のレベルが解放のレベルに届かない品目は、店に並べない（解放は品目の unlockLevel）', () => {
    const defs = { devices: { router_basic: { unlockLevel: 4 } }, furniture: {}, cables: { utp_cat5e: { unlockLevel: 1 } } };
    expect(isUnlocked({ device: 'router_basic' } as never, 3, defs)).toBe(false);
    expect(isUnlocked({ device: 'router_basic' } as never, 4, defs)).toBe(true);
    expect(isUnlocked({ cable: 'utp_cat5e' } as never, 1, defs)).toBe(true);
    expect(isUnlocked({ device: 'router_basic' } as never, 1, defs, true)).toBe(true);
  });

  it('資金が足りないと購入しない', () => {
    expect(buyDevice(100, {}, 'pc_basic', 200)).toEqual({ ok: false, reason: 'money' });
  });

  it('購入すると資金が減り、在庫が増える', () => {
    const r = buyDevice(1000, { pc_basic: 1 }, 'pc_basic', 300);
    expect(r).toEqual({ ok: true, money: 700, owned: { pc_basic: 2 } });
  });
});

describe('セーブのバージョン移行', () => {
  it('v1 のセーブを現在の形式まで移行できる', () => {
    const v1 = { clock: { minute: 0, money: 500, paidMonths: 0, bankrupt: false }, reputation: 1 };
    expect(migrate(1, v1)).toEqual({
      ...v1,
      // 評判は会社の経験値に名前を変える（v22）
      companyExp: 1,
      // 評判は v23 → v24 で 0 から始める（N55）
      reputation: 0,
      // 遊び方は移行で案件の経営ゲーム（career）になる
      mode: 'career',
      owned: {},
      completed: [],
      guidesDone: [],
      offers: [],
      nextOfferMinute: 0,
      offerSeq: 0,
      // 社員を作るときに乱数を進める
      rng: expect.any(Number),
      active: [],
      focus: null,
      office: {
        // 移行前の部屋は固定のマップ（14×8）の大きさ
        size: { w: 14, h: 8 },
        innerWalls: [],
        doors: [],
        annexes: [],
        nodes: [],
        links: [],
        seq: 0,
        furniture: [
          { uid: 'f0', id: 'desk', x: 2, y: 3 },
          { uid: 'f1', id: 'desk', x: 4, y: 3 },
        ],
        furnitureSeq: 2,
      },
      effects: { buildSpeed: 0 },
      staff: expect.any(Array),
      staffSeq: 2,
      candidates: [],
    });
  });

  it('形式が不正な在庫は拒否する', () => {
    expect(isSaveData({ clock: { minute: 0, money: 0, paidMonths: 0, bankrupt: false }, companyExp: 0, owned: { a: -1 }, completed: [] })).toBe(false);
  });
});

describe('在庫の売却', () => {
  it('購入時の値段に売値の割合を掛けた額で売れ、在庫が1つ減る（円未満は切り捨て）', () => {
    const r = sellDevice(1000, { pc_basic: 2 }, 'pc_basic', 65000, 0.8);
    expect(r).toEqual({ ok: true, money: 1000 + 52000, owned: { pc_basic: 1 } });
  });

  it('在庫がなければ売れず、何も変えない', () => {
    expect(sellDevice(1000, {}, 'pc_basic', 65000, 0.8)).toEqual({ ok: false, reason: 'stock' });
    expect(sellDevice(1000, { pc_basic: 0 }, 'pc_basic', 65000, 0.8)).toEqual({ ok: false, reason: 'stock' });
  });
});
