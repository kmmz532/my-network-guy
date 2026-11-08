// 自社オフィスの回線終端: 新しい会社には置かない。解放のレベルに届くと置き場所を選んで置け、有料で位置を変更できる
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance, GameMap } from '../data/schema';
import { EMPTY_FAMILIARITY } from './familiar';
import { initialOffice } from './furniture';
import { gameEnv } from './env';
import { expAtLevel } from './level';
import { emptyOffice, moveOfficeUplink, noEffects, officeUplinkOf, placeOfficeUplink, type Core, type Outcome } from './project';

const balance = balanceJson as unknown as Balance;
const unlock = balance.featureUnlocks.uplink;

const map = {
  id: 'test',
  width: 5,
  height: 4,
  tileSize: 32,
  floor: 'wood',
  legend: { '.': 'floor', '#': 'wall' },
  tiles: ['#####', '#...#', '#...#', '#####'],
} as unknown as GameMap;

const core = (level: number, money = 1000000): Core => ({
  clock: { minute: 0, money, paidMonths: 0, bankrupt: false, ledger: [] },
  companyExp: expAtLevel(level, balance),
  reputation: 0,
  owned: {},
  completed: [],
  deliveries: 0,
  familiarity: EMPTY_FAMILIARITY,
  purchaseDiscount: 0,
  offers: [],
  active: [],
  focus: null,
  office: emptyOffice({ w: 3, h: 2 }),
  effects: noEffects(),
  staff: [],
  staffSeq: 0,
  candidates: [],
  guidesDone: [],
} as unknown as Core);

const okCore = (o: Outcome): Core => {
  if (!o.ok) throw new Error(o.reason);
  return o.core;
};
const reasonOf = (o: Outcome): string | null => (o.ok ? null : o.reason);

describe('自社オフィスの回線終端', () => {
  it('新しい会社の事務所には、回線終端を置かない', () => {
    expect(initialOffice(balance).nodes.some((n) => n.device === 'uplink')).toBe(false);
  });

  it('解放のレベルより前は置けない', () => {
    expect(reasonOf(placeOfficeUplink(core(unlock - 1), 1, 1, map, gameEnv, balance))).toBe('uplink.locked');
  });

  it('解放のレベルに届くと、選んだマスに既設の機器として無料で置ける。2つ目は置けない', () => {
    const c = okCore(placeOfficeUplink(core(unlock), 2, 1, map, gameEnv, balance));
    const up = officeUplinkOf(c.office, gameEnv)!;
    expect({ x: up.x, y: up.y, locked: up.locked, configLocked: up.configLocked }).toEqual({ x: 2, y: 1, locked: true, configLocked: true });
    expect(c.clock.money).toBe(1000000);
    expect(reasonOf(placeOfficeUplink(c, 3, 1, map, gameEnv, balance))).toBe('uplink.placed');
  });

  it('壁には置けない', () => {
    expect(reasonOf(placeOfficeUplink(core(unlock), 0, 0, map, gameEnv, balance))).toBe('tile');
  });

  it('位置の変更は移設の費用を支払う。動かした後も既設の機器のまま', () => {
    const placed = okCore(placeOfficeUplink(core(unlock), 1, 1, map, gameEnv, balance));
    const moved = okCore(moveOfficeUplink(placed, 3, 2, map, gameEnv, balance));
    const up = officeUplinkOf(moved.office, gameEnv)!;
    expect({ x: up.x, y: up.y, locked: up.locked }).toEqual({ x: 3, y: 2, locked: true });
    expect(moved.clock.money).toBe(1000000 - balance.office.uplinkMoveCost);
  });

  it('移設の費用が払えなければ動かせない', () => {
    const placed = okCore(placeOfficeUplink(core(unlock, balance.office.uplinkMoveCost - 1), 1, 1, map, gameEnv, balance));
    expect(reasonOf(moveOfficeUplink(placed, 3, 2, map, gameEnv, balance))).toBe('money');
  });
});
