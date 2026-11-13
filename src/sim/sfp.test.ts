// 口の種類（SFP）。光ファイバーは SFP の口だけに挿せる（N-sfp）
import { describe, expect, it } from 'vitest';

import { portTypeOf } from './project';
import { cableDef } from '../registry/query';

describe('SFP の口', () => {
  it('L3 スイッチの口は、RJ45 の後に SFP が2つ並ぶ', () => {
    expect(portTypeOf('l3_switch', 0)).toBe('rj45');
    expect(portTypeOf('l3_switch', 8)).toBe('sfp');
    expect(portTypeOf('l3_switch', 9)).toBe('sfp');
  });

  it('PC の口は RJ45 だけ', () => {
    expect(portTypeOf('pc_basic', 0)).toBe('rj45');
  });

  it('光ファイバーは sfp、LAN ケーブルは rj45 の口の種類', () => {
    expect(cableDef('fiber_sm').port).toBe('sfp');
    expect(cableDef('fiber_mm').port).toBe('sfp');
    expect(cableDef('utp_cat5e').port).toBe('rj45');
  });
});
