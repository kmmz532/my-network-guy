// 押したときに、ケーブルの端をつかむか（N107）
import { describe, expect, it } from 'vitest';
import { grabsCableEnd } from './linkHit';

describe('ケーブルの端のつかみ方（N107）', () => {
  it('配線の道具で機器の上を押したときは、ケーブルの端をつかまない（新しいケーブルを引く）', () => {
    expect(grabsCableEnd('wire', true)).toBe(false);
  });

  it('配線の道具で機器の外（線の上）を押したときは、ケーブルの端をつかむ', () => {
    expect(grabsCableEnd('wire', false)).toBe(true);
  });

  it('選択の道具は、機器の上でもケーブルの端を先につかむ（挿し替えは選択の道具の操作）', () => {
    expect(grabsCableEnd('select', true)).toBe(true);
    expect(grabsCableEnd('select', false)).toBe(true);
  });
});
