// 無線対応のパソコン（pc_wifi）: 有線の口1つと無線。業務用の pc_basic は有線だけ
import { describe, expect, it } from 'vitest';
import { devices } from 'virtual:game-data';
import { can } from './capabilities';

describe('無線対応のパソコン', () => {
  it('無線の能力を持ち、有線の口は1つ。業務用の PC は無線を持たない', () => {
    expect(can('pc_wifi', 'wireless')).toBe(true);
    expect(can('pc_basic', 'wireless')).toBe(false);
    const d = devices.pc_wifi as { ports: { count: number }[]; category: string };
    expect(d.category).toBe('pc');
    expect(d.ports.reduce((s, p) => s + p.count, 0)).toBe(1);
  });
});
