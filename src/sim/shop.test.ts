import { describe, expect, it } from 'vitest';
import { buyDevice, isUnlocked } from './shop';
import { isSaveData, migrate } from '../services/migrations';

describe('ショップ', () => {
  it('解禁条件が満たされていない品目は陳列しない', () => {
    expect(isUnlocked({ device: 'router_basic', unlock: { contract: 'c002_small_office' } } as never, [])).toBe(false);
    expect(
      isUnlocked({ device: 'router_basic', unlock: { contract: 'c002_small_office' } } as never, ['c002_small_office']),
    ).toBe(true);
    expect(isUnlocked({ cable: 'utp_cat5e', unlock: null } as never, [])).toBe(true);
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
      owned: {},
      completed: [],
      offers: [],
      nextOfferMinute: 0,
      offerSeq: 0,
      // 社員を作るときに乱数を進める
      rng: expect.any(Number),
      active: [],
      focus: null,
      office: {
        nodes: [],
        links: [],
        seq: 0,
        furniture: [
          { uid: 'f0', id: 'desk', x: 3, y: 3 },
          { uid: 'f1', id: 'desk', x: 6, y: 3 },
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
    expect(isSaveData({ clock: { minute: 0, money: 0, paidMonths: 0, bankrupt: false }, reputation: 0, owned: { a: -1 }, completed: [] })).toBe(false);
  });
});
