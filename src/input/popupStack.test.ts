import { describe, expect, it } from 'vitest';
import { pushPopup, topPopup } from './popupStack';

describe('ポップアップの重ね順', () => {
  it('一番後に重ねたものが一番上になり、取り除くと下のものに戻る', () => {
    const a = { close: () => {} };
    const b = { close: () => {} };
    const removeA = pushPopup(a);
    const removeB = pushPopup(b);
    expect(topPopup()).toBe(b);
    removeB();
    expect(topPopup()).toBe(a);
    removeA();
    expect(topPopup()).toBeUndefined();
  });

  it('同じものを2回取り除いても壊れない', () => {
    const a = {};
    const remove = pushPopup(a);
    remove();
    remove();
    expect(topPopup()).toBeUndefined();
  });
});
