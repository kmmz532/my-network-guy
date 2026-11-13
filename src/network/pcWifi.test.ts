// 無線対応のパソコン（pc_wifi）: 有線の口1つと無線。業務用の pc_basic は有線だけ
import { describe, expect, it } from 'vitest';
import { can } from './capabilities';
import { deviceDef } from '../registry/query';

describe('無線対応のパソコン', () => {
  it('無線の能力を持ち、有線の口は1つ。業務用の PC は無線を持たない', () => {
    expect(can('pc_wifi', 'wireless')).toBe(true);
    expect(can('pc_basic', 'wireless')).toBe(false);
    const d = deviceDef('pc_wifi');
    expect(d.category).toBe('pc');
    expect(d.ports.reduce((s, p) => s + p.count, 0)).toBe(1);
  });
});
