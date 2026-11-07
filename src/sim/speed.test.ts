// 時間の速さ（N99）。解放の判定と、早送りの切り替え
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { isSpeedUnlocked, nextFastSpeed, unlockedSpeedsOf } from './speed';

const balance = balanceJson as unknown as Balance;

describe('速さの解放（N99）', () => {
  it('停止・1倍・2倍は最初から使え、4倍はレベル3、8倍はレベル6で解放する', () => {
    expect(unlockedSpeedsOf(1, balance)).toEqual([0, 1, 2]);
    expect(unlockedSpeedsOf(3, balance)).toEqual([0, 1, 2, 4]);
    expect(unlockedSpeedsOf(6, balance)).toEqual([0, 1, 2, 4, 8]);
  });

  it('解放前の速さは選べない', () => {
    expect(isSpeedUnlocked(4, 2, balance)).toBe(false);
    expect(isSpeedUnlocked(4, 3, balance)).toBe(true);
    expect(isSpeedUnlocked(8, 5, balance)).toBe(false);
    expect(isSpeedUnlocked(2, 1, balance)).toBe(true);
  });
});

describe('早送りの切り替え（N99）', () => {
  it('押すたびに 2倍 → 4倍 → 8倍 と切り替え、最後の次は 2倍に戻る', () => {
    const all = [0, 1, 2, 4, 8];
    expect(nextFastSpeed(1, all)).toBe(2);
    expect(nextFastSpeed(2, all)).toBe(4);
    expect(nextFastSpeed(4, all)).toBe(8);
    expect(nextFastSpeed(8, all)).toBe(2);
  });

  it('解放されていない速さは飛ばす（4倍が未解放なら 2倍 → 2倍）', () => {
    expect(nextFastSpeed(2, [0, 1, 2])).toBe(2);
    expect(nextFastSpeed(1, [0, 1, 2, 4])).toBe(2);
  });
});
