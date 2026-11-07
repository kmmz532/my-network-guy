// 口の種類（SFP）。光ファイバーは SFP の口だけに挿せる（N-sfp）
import { describe, expect, it } from 'vitest';
import { gameEnv } from './env';
import { portTypeOf } from './project';

describe('SFP の口', () => {
  it('L3 スイッチの口は、RJ45 の後に SFP が2つ並ぶ', () => {
    expect(portTypeOf(gameEnv, 'l3_switch', 0)).toBe('rj45');
    expect(portTypeOf(gameEnv, 'l3_switch', 8)).toBe('sfp');
    expect(portTypeOf(gameEnv, 'l3_switch', 9)).toBe('sfp');
  });

  it('PC の口は RJ45 だけ', () => {
    expect(portTypeOf(gameEnv, 'pc_basic', 0)).toBe('rj45');
  });

  it('光ファイバーは sfp、LAN ケーブルは rj45 の口の種類', () => {
    expect(gameEnv.cables.fiber_sm.port).toBe('sfp');
    expect(gameEnv.cables.fiber_mm.port).toBe('sfp');
    expect(gameEnv.cables.utp_cat5e.port).toBe('rj45');
  });
});
