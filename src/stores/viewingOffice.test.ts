// 自社オフィスを見ているかの判定（N112）。案件の数ではなく、focus と showcase で決める
import { describe, expect, it } from 'vitest';
import { useGameStore, viewingOffice } from './useGameStore';

describe('自社オフィスを見ているか（N112）', () => {
  it('案件がなければ、自社オフィスを見ている', () => {
    expect(viewingOffice({ focus: null, showcase: null })).toBe(true);
  });

  it('案件があっても、focus が null なら自社オフィスを見ている（N111 の切り替え）', () => {
    expect(viewingOffice({ focus: null, showcase: null })).toBe(true);
    useGameStore.setState({ active: [{ id: 'p1' } as never], focus: null, showcase: null });
    expect(viewingOffice(useGameStore.getState())).toBe(true);
  });

  it('案件を見ているときは、自社オフィスではない', () => {
    expect(viewingOffice({ focus: 'p1', showcase: null })).toBe(false);
  });

  it('案件が見つからなくても、例外にならず、自社オフィスの扱いになる（focus が null で案件があるとき、配置が例外にならない）', () => {
    useGameStore.setState({ active: [{ id: 'p1' } as never], focus: null, showcase: null, maps: {} as never });
    expect(() => useGameStore.getState().place('pc_basic', 1, 1)).not.toThrow();
  });
});
