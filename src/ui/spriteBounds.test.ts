import { describe, expect, it } from 'vitest';
import { opaqueBoundsOf } from './spriteBounds';

// 幅 4、高さ 3 の画像。α が 0 でない画素（x 1〜2、y 1〜2）だけが不透明
const rgbaOf = (opaque: [number, number][], w: number, h: number): Uint8ClampedArray => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of opaque) data[(y * w + x) * 4 + 3] = 255;
  return data;
};

describe('opaqueBoundsOf', () => {
  it('不透明な画素を含む最小の矩形を返す', () => {
    const data = rgbaOf(
      [
        [1, 1],
        [2, 2],
      ],
      4,
      3,
    );
    expect(opaqueBoundsOf(data, 4, 3)).toEqual({ x: 1, y: 1, w: 2, h: 2 });
  });

  it('α が 1 以上の画素も不透明とみなす', () => {
    const data = new Uint8ClampedArray(4 * 4);
    data[3] = 1;
    expect(opaqueBoundsOf(data, 1, 1)).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it('不透明な画素がなければ null', () => {
    expect(opaqueBoundsOf(rgbaOf([], 4, 3), 4, 3)).toBeNull();
  });
});
