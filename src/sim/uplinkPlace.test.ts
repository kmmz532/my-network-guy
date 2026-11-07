// 自社オフィスの回線終端の位置（N144 の残り）: 上の壁沿い、机のないマス。動かせない既設の機器
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { initialOffice, uplinkTileOf } from './furniture';

const balance = balanceJson as unknown as Balance;

describe('自社オフィスの回線終端', () => {
  it('新しい会社の事務所に、回線終端が1つ既設として置かれる（動かせない・設定も変えられない）', () => {
    const office = initialOffice(balance);
    const up = office.nodes.filter((n) => n.device === 'uplink');
    expect(up.length).toBe(1);
    expect(up[0].locked).toBe(true);
    expect(up[0].configLocked).toBe(true);
  });

  it('回線終端は、上の壁沿いの行（y = 1）で、机のないマスに置く', () => {
    const office = initialOffice(balance);
    const up = office.nodes.find((n) => n.device === 'uplink')!;
    expect(up.y).toBe(1);
    expect(office.furniture.some((f) => f.x === up.x && f.y === up.y)).toBe(false);
  });

  it('上の行がすべて机なら、置けないとして例外で止める（黙って置かない）', () => {
    const size = { w: 3, h: 3 };
    const desks = [1, 2, 3].map((x) => ({ x, y: 1 }));
    expect(() => uplinkTileOf(size, desks)).toThrow();
  });
});
