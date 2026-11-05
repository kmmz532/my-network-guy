import { describe, expect, it } from 'vitest';
import { placeTip } from './tipLayout';

const view = { width: 375, height: 667 };
const size = { width: 200, height: 40 };

describe('ツールチップの位置', () => {
  it('要素の上側の中央に出す', () => {
    expect(placeTip({ x: 150, y: 600, w: 40, h: 40 }, size, view)).toEqual({ left: 70, top: 552 });
  });

  it('上にはみ出すときは下側に回す', () => {
    expect(placeTip({ x: 150, y: 10, w: 40, h: 40 }, size, view).top).toBe(58);
  });

  it('右端のボタンでも画面からはみ出さない', () => {
    expect(placeTip({ x: 340, y: 600, w: 30, h: 30 }, size, view).left).toBe(375 - 200 - 4);
  });
});
