import { describe, expect, it } from 'vitest';
import type { NetLink } from '../network/types';
import { distanceToPath, linkAt } from './linkHit';

const link = (uid: string, path: [number, number][]): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: 'a', port: 0 }, b: { node: 'b', port: 0 }, path }) as NetLink;

describe('配線の上の判定', () => {
  it('折れ線の上の点までの距離を返す', () => {
    const path: [number, number][] = [
      [0, 0],
      [4, 0],
      [4, 4],
    ];
    expect(distanceToPath(2, 0, path)).toBe(0);
    expect(distanceToPath(4, 2, path)).toBe(0);
    expect(distanceToPath(6, 0, path)).toBeCloseTo(2);
  });

  it('近くの配線を選び、遠ければ選ばない', () => {
    const links = [link('l0', [[0, 0], [4, 0]]), link('l1', [[0, 5], [4, 5]])];
    expect(linkAt(links, 2, 0.2, 0.3)?.uid).toBe('l0');
    expect(linkAt(links, 2, 2.5, 0.3)).toBeUndefined();
  });
});
