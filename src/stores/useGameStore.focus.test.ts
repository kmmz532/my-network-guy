// 画面の対象の切り替え（N111）
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';
import { useUiStore } from './useUiStore';

const st = () => useGameStore.getState();

describe('画面の対象の切り替え（N111）', () => {
  beforeEach(() => {
    useUiStore.setState({ wireStart: { uid: 'n1', port: null } });
    useGameStore.setState({ active: [{ id: 'p1', nodes: [], links: [], plans: {}, contract: { map: 'hq' } } as never], focus: 'p1', placing: 'pc_basic' });
  });

  it('自社オフィス（null）と案件を行き来できる', () => {
    st().setFocus(null);
    expect(st().focus).toBeNull();
    st().setFocus('p1');
    expect(st().focus).toBe('p1');
  });

  it('進行中でない案件には切り替えない', () => {
    st().setFocus('nope');
    expect(st().focus).toBe('p1');
  });

  it('切り替えると、配線の途中と置く予定を取り消す', () => {
    st().setFocus(null);
    expect(useUiStore.getState().wireStart).toBeNull();
    expect(st().placing).toBeNull();
  });
});
