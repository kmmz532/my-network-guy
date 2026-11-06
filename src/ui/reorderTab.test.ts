// ウィンドウのタブの並べ替え（N43）。並べ替えても、選んでいるタブと中身は変わらない
import { describe, expect, it } from 'vitest';
import { reorderTab, type WindowList } from './windows';

const list = (tabs: string[], active: string): WindowList =>
  ({
    windows: [{ id: 1, kind: 'device', tabs, active, x: 0, y: 0, w: 300, h: 300, z: 1 }],
    seq: 1,
  }) as unknown as WindowList;

describe('reorderTab', () => {
  it('タブを前から後ろへ動かす', () => {
    const out = reorderTab(list(['a', 'b', 'c'], 'a'), 1, 0, 2);
    expect(out.windows[0].tabs).toEqual(['b', 'c', 'a']);
    expect(out.windows[0].active).toBe('a');
  });

  it('タブを後ろから前へ動かす', () => {
    const out = reorderTab(list(['a', 'b', 'c'], 'c'), 1, 2, 0);
    expect(out.windows[0].tabs).toEqual(['c', 'a', 'b']);
    expect(out.windows[0].active).toBe('c');
  });

  it('同じ位置や範囲外なら、同じ一覧を返す', () => {
    const base = list(['a', 'b'], 'a');
    expect(reorderTab(base, 1, 1, 1)).toBe(base);
    expect(reorderTab(base, 1, 0, 5)).toBe(base);
    expect(reorderTab(base, 9, 0, 1)).toBe(base);
  });
});
