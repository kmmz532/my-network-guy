import { describe, expect, it } from 'vitest';
import { rangeTiles } from './effectRange';

describe('家具の効果の範囲', () => {
  it('範囲2なら、中心の周り5×5マスになる', () => {
    expect(rangeTiles(5, 5, 2, 20, 20)).toHaveLength(25);
  });

  it('マップの外のマスは含めない', () => {
    expect(rangeTiles(0, 0, 2, 20, 20)).toHaveLength(9);
  });
});
