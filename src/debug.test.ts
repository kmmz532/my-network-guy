import { describe, expect, it } from 'vitest';
import { isDebugEnabled } from './debug';

describe('isDebugEnabled（?debug=1 または ?debug=true のときだけ有効）', () => {
  it('1 と true は有効', () => {
    expect(isDebugEnabled('?debug=1')).toBe(true);
    expect(isDebugEnabled('?debug=true')).toBe(true);
    expect(isDebugEnabled('?x=2&debug=1')).toBe(true);
  });
  it('0・false・yes・空・パラメータなしは無効', () => {
    expect(isDebugEnabled('?debug=0')).toBe(false);
    expect(isDebugEnabled('?debug=false')).toBe(false);
    expect(isDebugEnabled('?debug=yes')).toBe(false);
    expect(isDebugEnabled('?debug=')).toBe(false);
    expect(isDebugEnabled('')).toBe(false);
    expect(isDebugEnabled('?other=1')).toBe(false);
  });
});
