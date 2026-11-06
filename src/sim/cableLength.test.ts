// ケーブルの長さ（N49）。UTP は 20 マス（100 m）まで。21 マスは「長すぎる」。1マスは 5 m
import { describe, expect, it } from 'vitest';
import { checkCableLength, metersOf } from './cableLength';

describe('ケーブルの長さ', () => {
  it('UTP の上限 20 マスは通り、21 マスは長すぎる', () => {
    expect(checkCableLength(20, 20)).toBe('ok');
    expect(checkCableLength(21, 20)).toBe('cableTooLong');
  });

  it('0マスは届かない長さ（cable）', () => {
    expect(checkCableLength(0, 20)).toBe('cable');
  });

  it('1マスは 5 m、20マスは 100 m', () => {
    expect(metersOf(1, 5)).toBe(5);
    expect(metersOf(20, 5)).toBe(100);
  });
});
