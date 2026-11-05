import { describe, expect, it } from 'vitest';
import type { NetLink } from '../network/types';
import { centerPath, distanceToPath, linkAt } from './linkHit';

const link = (uid: string, path: [number, number][]): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: 'a', port: 0 }, b: { node: 'b', port: 0 }, path }) as NetLink;

const TS = 32;

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

  it('マスの中央を通る折れ線に直す', () => {
    expect(centerPath([[0, 1]], TS)).toEqual([[16, 48]]);
  });

  it('拡大率 1 では 8 px 以内を判定し、超えたら選ばない', () => {
    const links = [link('l0', [[0, 0], [1, 0]])];
    // 配線は y = 16（マスの中央）を通る
    expect(linkAt(links, 16, 16 + 8, TS, 1)?.uid).toBe('l0');
    expect(linkAt(links, 16, 16 + 9, TS, 1)).toBeUndefined();
  });

  it('拡大率で割った距離で判定する（拡大率 2 では 4 マップ px 以内）', () => {
    const links = [link('l0', [[0, 0], [1, 0]])];
    expect(linkAt(links, 16, 16 + 4, TS, 2)?.uid).toBe('l0');
    expect(linkAt(links, 16, 16 + 5, TS, 2)).toBeUndefined();
  });

  it('近くの配線を選ぶ', () => {
    const links = [link('l0', [[0, 0], [2, 0]]), link('l1', [[0, 1], [2, 1]])];
    expect(linkAt(links, 40, 16 + 3, TS, 1)?.uid).toBe('l0');
    expect(linkAt(links, 40, 48 - 3, TS, 1)?.uid).toBe('l1');
  });
});
