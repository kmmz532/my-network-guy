// 自社オフィスの床の張り替え（N92）。部屋の判定・費用・解禁・マップへの反映
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { expAtLevel } from './level';
import { changeOfficeFloor, floorOfRoom, mapOfOffice, roomOf, roomTileCount } from './office';
import type { Core, Office } from './project';

const balance = balanceJson as unknown as Balance;
const ANNEX_DEPTH = 5;
const ANNEX_STEP = ANNEX_DEPTH + 1;

// 床 6×6 の主の部屋（外側の壁を含むマスの座標は 1〜6）
const base: Office = { bought: ['wood' as const], segments: {},
  size: { w: 6, h: 6 },
  innerWalls: [],
  doors: [],
  annexes: [],
  nodes: [],
  links: [],
  seq: 0,
  furniture: [],
  furnitureSeq: 0,
};

const core = (office: Office, level: number, money = 1000000): Core =>
  ({
    office,
    companyExp: expAtLevel(level, balance),
    clock: { minute: 0, money, paidMonths: 0, bankrupt: false, ledger: [] },
  }) as unknown as Core;

describe('部屋の判定（N92）', () => {
  it('別室がなければ、すべてのマスは主の部屋', () => {
    expect(roomOf(base, 1, 1)).toBe('main');
    expect(roomOf(base, 6, 6)).toBe('main');
  });

  it('右の別室は、仕切り（w − 5）の右側。下の別室は全幅で、下の別室の行', () => {
    const office: Office = { ...base, size: { w: 12, h: 8 }, annexes: ['right', 'bottom'] };
    expect(roomOf(office, 12, 1)).toBe('right');
    expect(roomOf(office, 7, 1)).toBe('main');
    // 下の別室は行 h − 5 より下（y > 3）。右の別室は、その手前まで
    expect(roomOf(office, 12, 5)).toBe('bottom');
    expect(roomOf(office, 1, 8)).toBe('bottom');
  });

  it('左の別室は、仕切り（ANNEX_STEP）の左側', () => {
    const office: Office = { ...base, size: { w: 12, h: 8 }, annexes: ['left'] };
    expect(roomOf(office, 1, 1)).toBe('left');
    expect(roomOf(office, ANNEX_STEP + 1, 1)).toBe('main');
  });

  it('部屋のマス数は、内側の壁を除く', () => {
    const office: Office = { ...base, innerWalls: [{ x: 2, y: 2 }] };
    expect(roomTileCount(office, 'main')).toBe(36 - 1);
  });

  it('床の種類は、書いていなければ木', () => {
    expect(floorOfRoom(base, 'main')).toBe('wood');
    expect(floorOfRoom({ ...base, floors: { main: 'tile' } }, 'main')).toBe('tile');
  });
});

describe('床の張り替え（N92）', () => {
  it('床の張り替えは、会社のレベル5（featureUnlocks.floorChange）から', () => {
    expect(changeOfficeFloor(core(base, 4), 'main', 'tile', balance)).toEqual({ ok: false, reason: 'floor.locked' });
  });

  it('床の種類は、それぞれの解禁のレベルで使える（タイルは5、カーペットは8）', () => {
    expect(changeOfficeFloor(core(base, 5), 'main', 'tile', balance).ok).toBe(true);
    expect(changeOfficeFloor(core(base, 5), 'main', 'carpet', balance)).toEqual({ ok: false, reason: 'floor.locked' });
    expect(changeOfficeFloor(core(base, 8), 'main', 'carpet', balance).ok).toBe(true);
  });

  it('費用は、1マスの費用 × その部屋の床のマス数。その場で払い、帳簿は内装', () => {
    const tile = balance.floors.find((f) => f.id === 'tile')!;
    const out = changeOfficeFloor(core(base, 5, 1000000), 'main', 'tile', balance);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.core.clock.money).toBe(1000000 - tile.costPerTile * 36);
    expect(out.core.office.floors?.main).toBe('tile');
    expect(out.core.clock.ledger?.[0]?.totals.interior).toBe(-tile.costPerTile * 36);
  });

  it('お金が足りなければ、張り替えられない（money）', () => {
    expect(changeOfficeFloor(core(base, 5, 0), 'main', 'tile', balance)).toEqual({ ok: false, reason: 'money' });
  });

  it('別室の床は、その部屋だけ変わる', () => {
    const office: Office = { ...base, size: { w: 12, h: 6 }, annexes: ['right'] };
    const out = changeOfficeFloor(core(office, 5), 'right', 'tile', balance);
    expect(out.ok && out.core.office.floors).toEqual({ right: 'tile' });
    expect(out.ok && floorOfRoom(out.core.office, 'main')).toBe('wood');
  });

  it('一度買った床は、買い切り。戻して敷き直しても、代金は1回だけ（N125）', () => {
    const tile = balance.floors.find((f) => f.id === 'tile')!;
    const bought = changeOfficeFloor(core(base, 5, 1000000), 'main', 'tile', balance);
    if (!bought.ok) throw new Error('購入できない');
    expect(bought.core.office.bought).toEqual(['wood', 'tile']);
    const back = changeOfficeFloor(bought.core, 'main', 'wood', balance);
    if (!back.ok) throw new Error('戻せない');
    const again = changeOfficeFloor(back.core, 'main', 'tile', balance);
    expect(again.ok && again.core.clock.money).toBe(1000000 - tile.costPerTile * 36);
    expect(again.ok && again.core.office.floors?.main).toBe('tile');
  });

  it('買い切りの床は、部屋を広げた別室にも無料で敷ける（N125）', () => {
    const tile = balance.floors.find((f) => f.id === 'tile')!;
    const office: Office = { ...base, bought: ['wood', 'tile'], size: { w: 12, h: 6 }, annexes: ['right'] };
    const out = changeOfficeFloor(core(office, 5, 0), 'right', 'tile', balance);
    expect(out.ok).toBe(true);
    expect(out.ok && tile.costPerTile).toBeGreaterThan(0);
  });

  it('床と同じ種類に変えるときは、費用なし', () => {
    const out = changeOfficeFloor(core(base, 5, 0), 'main', 'wood', balance);
    expect(out.ok).toBe(true);
  });
});

describe('マップの床（N92）', () => {
  it('木のままの部屋は、マップに床の種類を書かない', () => {
    expect(mapOfOffice(base).floorTiles).toBeUndefined();
  });

  it('張り替えた部屋のマスだけ、その床の種類になる', () => {
    const map = mapOfOffice({ ...base, floors: { main: 'carpet' } });
    expect(map.floorTiles?.['1,1']).toBe('carpet');
    expect(Object.keys(map.floorTiles ?? {}).length).toBe(36);
  });
});
