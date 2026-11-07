// 机と椅子（N44）。机だけの品目も席として数える。初期の在庫に机が2台ある
import { describe, expect, it } from 'vitest';
import { furniture as furnitureData } from 'virtual:game-data';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { freeDesks } from './furniture';
import { isDeskFurniture, type Env } from './project';

const balance = balanceJson as unknown as Balance;
const env = { furniture: furnitureData } as unknown as Env;

describe('机と椅子（N44）', () => {
  it('机だけの品目は、席として数える（机と同じく社員が座れる）', () => {
    expect(isDeskFurniture('desk_only', env)).toBe(true);
    expect(isDeskFurniture('plant', env)).toBe(false);
    const office = { furniture: [{ uid: 'f0', id: 'desk_only', x: 1, y: 1 }] } as never;
    expect(freeDesks(office, [], (id) => (furnitureData as Record<string, { seat?: boolean }>)[id]?.seat === true).length).toBe(1);
  });

  it('部屋の机は2つで、インベントリに机はない（B12）', () => {
    expect(balance.initialStock.desk).toBeUndefined();
    expect(balance.staff.initialDesks.length).toBe(2);
  });

  it('机の絵は椅子を含まない。椅子は別の絵で、机の手前に描く（B10）', () => {
    expect((furnitureData as Record<string, { sprite: string }>).desk.sprite).toBe('furniture/desk');
    expect((furnitureData as Record<string, { sprite: string }>).desk_only.sprite).toBe('furniture/desk');
  });
});
