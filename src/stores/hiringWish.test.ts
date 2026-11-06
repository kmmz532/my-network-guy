// 募集の職種の指定: 人事がいないと指定できない
import { describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';

describe('募集の職種の指定（店）', () => {
  it('人事がいないときは指定できず、理由を返す', () => {
    useGameStore.setState({ staff: [], office: { ...useGameStore.getState().office, furniture: [] } });
    expect(useGameStore.getState().setHiringWish('sales')).toBe('ui.error.hr');
    expect(useGameStore.getState().hiringWish).toBeNull();
  });
});
