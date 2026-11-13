// SVI の上限は登録表の定義から引く（L3 スイッチは持ち、PC は持たない）
import { describe, expect, it } from 'vitest';
import { sviMaxOf } from './netEdit';

describe('SVI の上限', () => {
  it('SVI を持つ L3 スイッチは上限を持ち、PC は 0 になる', () => {
    expect(sviMaxOf('l3_switch')).toBeGreaterThan(0);
    expect(sviMaxOf('pc_basic')).toBe(0);
  });
});
