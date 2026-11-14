// サンドボックスの部屋の拡張（N59）。解放のレベルも費用も問わず広がり、資金は変わらない
import { beforeEach, describe, expect, it } from 'vitest';
import { useGameStore } from './useGameStore';

const st = () => useGameStore.getState();

describe('サンドボックスの部屋の拡張（N59）', () => {
  beforeEach(() => {
    st().newSandbox();
  });

  it('解放のレベルがなくても広がり、資金は変わらない', () => {
    const before = st().office.size;
    const money = st().clock.money;
    const reason = st().expandOffice('right');
    expect(reason).toBeNull();
    expect(st().office.size.w).toBeGreaterThan(before.w);
    expect(st().clock.money).toBe(money);
  });

  it('通常のゲームの解放（レベル）の判定を、サンドボックスには使わない', () => {
    // 会社のレベルが 1 でも広げられる（サンドボックスは解放を問わない）
    expect(st().companyExp).toBeLessThan(1000);
    expect(st().expandOffice('bottom')).toBeNull();
  });

  it('回線終端は、解放のレベルがなくても置ける', () => {
    const money = st().clock.money;
    expect(st().place('uplink', 2, 2)).toBeNull();
    expect(st().office.nodes.some((n) => n.device === 'uplink')).toBe(true);
    expect(st().clock.money).toBe(money);
  });
});
