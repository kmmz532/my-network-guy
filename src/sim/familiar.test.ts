// なじみの依頼（N70）の数え方・型紙・写せるかの判定
import { describe, expect, it } from 'vitest';
import { EMPTY_FAMILIARITY, fitsBlueprint, familiarKeyOf, recordDelivery, type Blueprint } from './familiar';
import type { NetNode } from '../network/types';

const node = (uid: string, device: string, x: number, y: number): NetNode => ({
  uid,
  device,
  x,
  y,
  locked: true,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
});
const design: Blueprint = { nodes: [node('pc_1', 'pc_basic', 1, 1), node('sw', 'l2_switch_8p', 3, 1)], links: [], segments: {} };

describe('なじみの依頼の組', () => {
  it('固定の案件は ID、テンプレートはひな形と地図の組で数える', () => {
    expect(familiarKeyOf('fixed', 'c001', 'office')).toBe('fixed:c001');
    expect(familiarKeyOf('template', 't_small_lan', 'office')).toBe('t_small_lan|office');
  });

  it('★2以上だけを数え、★1は数えない', () => {
    const f1 = recordDelivery(EMPTY_FAMILIARITY, 'k', 1, design);
    expect(f1).toBe(EMPTY_FAMILIARITY);
    const f2 = recordDelivery(f1, 'k', 2, design);
    expect(f2.counts.k).toBe(1);
  });

  it('型紙は組ごとに1つ。★が同じか多ければ上書きし、少なければ残す', () => {
    const a = recordDelivery(EMPTY_FAMILIARITY, 'k', 3, design);
    const other: Blueprint = { ...design, nodes: [] };
    const b = recordDelivery(a, 'k', 2, other);
    expect(b.blueprints.k.design).toBe(design);
    const c = recordDelivery(b, 'k', 3, other);
    expect(c.blueprints.k.design).toBe(other);
  });
});

describe('型紙の写せるか', () => {
  it('今回の依頼の機器が、型紙に同じ位置で全部あれば写せる', () => {
    expect(fitsBlueprint(design, [node('pc_1', 'pc_basic', 1, 1)])).toBe(true);
  });

  it('位置や種類が違う機器があれば写せない', () => {
    expect(fitsBlueprint(design, [node('pc_1', 'pc_basic', 2, 1)])).toBe(false);
    expect(fitsBlueprint(design, [node('pc_9', 'pc_basic', 1, 1)])).toBe(false);
  });
});
