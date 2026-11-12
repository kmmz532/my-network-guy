// 置いたあと、選んでいる品目を外すかの判定（在庫が0になったときだけ外す）
import { describe, expect, it } from 'vitest';
import { clearsPlacing } from './shop';

describe('置いたあとの選択', () => {
  it('在庫1の品目を置くと（在庫が0になると）選択を外す。在庫が残るなら外さない', () => {
    expect(clearsPlacing({ router_basic: 1 }, 'router_basic', false)).toBe(false);
    expect(clearsPlacing({ router_basic: 0 }, 'router_basic', false)).toBe(true);
    expect(clearsPlacing({}, 'router_basic', false)).toBe(true);
  });

  it('サンドボックスは在庫が無限のため、外さない', () => {
    expect(clearsPlacing({}, 'router_basic', true)).toBe(false);
  });
});
