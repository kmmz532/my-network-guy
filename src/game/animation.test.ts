import { describe, expect, it } from 'vitest';
import { cumulativeLengths, pointAt } from './animation';

const line = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
];

describe('経路上の位置', () => {
  it('道のりを累積で求める', () => {
    expect(cumulativeLengths(line)).toEqual([0, 10, 20]);
  });

  it('折れ点をまたいで位置を求める', () => {
    const c = cumulativeLengths(line);
    expect(pointAt(line, c, 5)).toEqual({ x: 5, y: 0 });
    expect(pointAt(line, c, 15)).toEqual({ x: 10, y: 5 });
  });

  it('経路の外は端に丸める', () => {
    const c = cumulativeLengths(line);
    expect(pointAt(line, c, -3)).toEqual({ x: 0, y: 0 });
    expect(pointAt(line, c, 99)).toEqual({ x: 10, y: 10 });
  });
});
