// 会社のレベル（N45）の式と解放。LEVEL.md §8 のテスト
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { expAtLevel, isUnlocked, levelOf, levelProgressOf, levelUpsBetween, moneyOf, nextLevel, needOf, titleKeyOf } from './level';

const balance = balanceJson as unknown as Balance;

describe('会社のレベルの式', () => {
  it('必要な経験値は式の値（Lv1→2 が 2、Lv10→11 が約40）', () => {
    expect(needOf(1, balance)).toBe(2);
    expect(needOf(10, balance)).toBe(40);
  });

  it('Lv1〜999 で、レベルと累計の経験値が互いに矛盾しない', () => {
    for (let n = 1; n <= 999; n++) {
      const exp = expAtLevel(n, balance);
      expect(levelOf(exp, balance)).toBe(n);
      if (n > 1) expect(levelOf(exp - 1, balance)).toBe(n - 1);
    }
  });

  it('最大レベルで止まり、次のレベルはない', () => {
    expect(levelOf(expAtLevel(999, balance) + 1_000_000, balance)).toBe(999);
    expect(nextLevel(expAtLevel(999, balance) + 1, balance)).toBeNull();
  });

  it('次のレベルまでの経験値は、あと何点かを返す', () => {
    expect(nextLevel(0, balance)).toEqual({ level: 2, need: 2 });
  });

  it('毎回のお金は 1000 円単位で、レベルとともに増える', () => {
    expect(moneyOf(2, balance) % 1000).toBe(0);
    expect(moneyOf(50, balance)).toBeGreaterThan(moneyOf(2, balance));
  });

  it('解放は、品目の unlockLevel が今のレベル以下のとき', () => {
    expect(isUnlocked(10, 9)).toBe(false);
    expect(isUnlocked(10, 10)).toBe(true);
  });

  it('称号は 100 の倍数と 999 にだけある', () => {
    expect(titleKeyOf(100)).toBe('level.title.100');
    expect(titleKeyOf(999)).toBe('level.title.999');
    expect(titleKeyOf(150)).toBeNull();
  });
});

describe('レベルが上がったときの報酬と解放', () => {
  it('2つ以上上がったら、各レベルの報酬と解放を全部入れる', () => {
    const items = [
      { kind: 'device' as const, id: 'l2_switch_8p', unlockLevel: 2 },
      { kind: 'device' as const, id: 'router_basic', unlockLevel: 4 },
    ];
    const ups = levelUpsBetween(1, 4, balance, [{ level: 3, reward: { devices: [{ device: 'l2_switch_8p', count: 1 }] } }], items);
    expect(ups.map((u) => u.level)).toEqual([2, 3, 4]);
    expect(ups[0].unlocks).toEqual([{ kind: 'device', id: 'l2_switch_8p' }]);
    expect(ups[1].devices).toEqual([{ device: 'l2_switch_8p', count: 1 }]);
    expect(ups[2].unlocks).toEqual([{ kind: 'device', id: 'router_basic' }]);
    expect(ups.every((u) => u.money > 0)).toBe(true);
  });

  it('上がらなければ何もない', () => {
    expect(levelUpsBetween(3, 3, balance, [], [])).toEqual([]);
  });
});

describe('レベル内の進み具合（N66 の経験値のゲージ）', () => {
  it('レベルの境目では 0 になる', () => {
    for (let n = 1; n <= 50; n++) expect(levelProgressOf(expAtLevel(n, balance), balance)).toBe(0);
  });

  it('次のレベルの直前は 1 に近く、1 を超えない', () => {
    for (let n = 1; n <= 50; n++) {
      const top = expAtLevel(n + 1, balance) - 1;
      const v = levelProgressOf(top, balance);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('途中は、今のレベルの必要経験値に対する割合になる', () => {
    const start = expAtLevel(3, balance);
    const half = start + Math.floor(needOf(3, balance) / 2);
    expect(levelProgressOf(half, balance)).toBeCloseTo(Math.floor(needOf(3, balance) / 2) / needOf(3, balance), 9);
  });

  it('最大レベルでは満ちたままになる', () => {
    expect(levelProgressOf(expAtLevel(balance.level.max, balance), balance)).toBe(1);
    expect(levelProgressOf(expAtLevel(balance.level.max, balance) + 500, balance)).toBe(1);
  });
});
