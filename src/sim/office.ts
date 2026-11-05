// 自社オフィスの部屋の大きさと広げ方（純粋関数）。大きさからマップを作り、右・下・左の辺を買って広げる。
// 辺が上限に達したら、その辺の外に別室を足す（1辺に1つまで。別室は広げられない）。
import type { Balance, GameMap } from '../data/schema';
import { officeLocked, type Core, type Office, type OfficeCell, type OfficeSide, type OfficeSize, type Outcome } from './project';

export type ExpandSide = OfficeSide;
export type OfficeConfig = Balance['office'];
// 辺の操作。expand は床を広げる、annex は別室を足す
export type ExpandAction = 'expand' | 'annex';

const fail = (reason: string): Outcome => ({ ok: false, reason });

// 奥の壁の窓。WINDOW_WIDTH マスの窓を、床の左端から WINDOW_PERIOD マスごとに置く（床の内側に収まるものだけ）
const WINDOW_PERIOD = 10;
const WINDOW_WIDTH = 2;
const TILE_SIZE = 32;

// 別室。仕切りの壁が1マス、その先に奥行き ANNEX_DEPTH マスの床を足す
const ANNEX_DEPTH = 5;
const ANNEX_STEP = ANNEX_DEPTH + 1;

// 床の大きさと内側の壁・ドアから、部屋のマップを作る。奥の壁（上）に窓、外側の壁（下・左右）、内側の壁、ドア、残りは床
export const officeMapOf = (size: OfficeSize, innerWalls: OfficeCell[] = [], doors: OfficeCell[] = []): GameMap => {
  const width = size.w + 2;
  const height = size.h + 2;
  const back = Array.from({ length: width }, () => '#');
  for (let x = 1; x + WINDOW_WIDTH - 1 <= size.w; x += WINDOW_PERIOD) {
    for (let i = 0; i < WINDOW_WIDTH; i++) back[x + i] = 'W';
  }
  const grid = Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => {
      if (y === 0) return back[x];
      return x === 0 || x === width - 1 || y === height - 1 ? '#' : '.';
    }),
  );
  for (const c of innerWalls) if (grid[c.y]?.[c.x] !== undefined) grid[c.y][c.x] = '#';
  for (const c of doors) if (grid[c.y]?.[c.x] !== undefined) grid[c.y][c.x] = 'D';
  return {
    id: 'hq',
    width,
    height,
    tileSize: TILE_SIZE,
    legend: { '.': 'floor', '#': 'wall', W: 'window', D: 'door' },
    tiles: grid.map((row) => row.join('')),
  };
};

// 自社オフィスのマップ（内側の壁・ドアを含む）
export const mapOfOffice = (office: Office): GameMap => officeMapOf(office.size, office.innerWalls, office.doors);

// 広げた回数。床の増えた分（step マスずつ）から数える。新しく始めた部屋は0回
export const expandCountOf = (size: OfficeSize, initial: OfficeSize, step: number): number =>
  Math.max(0, Math.floor((size.w - initial.w + (size.h - initial.h)) / step));

// 次に広げる費用（円）。baseCost から、広げた回数ごとに growth 倍になる
export const expandCostOf = (size: OfficeSize, config: OfficeConfig): number =>
  Math.round(config.expand.baseCost * config.expand.growth ** expandCountOf(size, config.initialSize, config.expand.step));

// 本体の部屋の床の大きさ（別室の床を除く）。上限と費用は本体で数える
export const mainSizeOf = (office: Office): OfficeSize => {
  const across = office.annexes.filter((s) => s !== 'bottom').length;
  const down = office.annexes.includes('bottom') ? 1 : 0;
  return { w: office.size.w - across * ANNEX_STEP, h: office.size.h - down * ANNEX_STEP };
};

// 辺の次の操作。辺に別室があれば何もできない（null）。本体がまだ上限でなければ広げる。上限なら別室を足す
export const expandActionOf = (office: Office, side: ExpandSide, config: OfficeConfig): ExpandAction | null => {
  if (office.annexes.includes(side)) return null;
  return canExpand(mainSizeOf(office), side, config) ? 'expand' : 'annex';
};

// 次に広げる（別室を足す）費用。本体の大きさで決める
export const officeExpandCostOf = (office: Office, config: OfficeConfig): number => expandCostOf(mainSizeOf(office), config);

// 辺を広げたあとの床の大きさ。右と左は幅、下は高さが step マス増える
export const expandedSizeOf = (size: OfficeSize, side: ExpandSide, step: number): OfficeSize =>
  side === 'bottom' ? { w: size.w, h: size.h + step } : { w: size.w + step, h: size.h };

// 上限（maxSize）を超えないか
export const canExpand = (size: OfficeSize, side: ExpandSide, config: OfficeConfig): boolean => {
  const next = expandedSizeOf(size, side, config.expand.step);
  return next.w <= config.expand.maxSize.w && next.h <= config.expand.maxSize.h;
};

// 機器・家具・ケーブル・内側の壁・ドアの座標を dx だけずらす（左に広げたときに使う）
const shiftOffice = (office: Office, dx: number): Office => ({
  ...office,
  nodes: office.nodes.map((n) => ({ ...n, x: n.x + dx })),
  furniture: office.furniture.map((f) => ({ ...f, x: f.x + dx })),
  links: office.links.map((l) => ({ ...l, path: l.path.map(([x, y]) => [x + dx, y] as [number, number]) })),
  innerWalls: office.innerWalls.map((c) => ({ x: c.x + dx, y: c.y })),
  doors: office.doors.map((c) => ({ x: c.x + dx, y: c.y })),
});

// 別室の仕切りの壁を、いまの大きさに合わせて足す（既にある壁・ドアは変えない）。
// 右・左の仕切りは床の高さ分。下の別室があれば、その手前（下の別室の仕切りの上）まで。下の別室の仕切りは、床の幅いっぱい。
// これで、別室どうしの角も壁になり、部屋がつながらない
const sealAnnexes = (office: Office): Office => {
  const { w, h } = office.size;
  const taken = new Set([...office.innerWalls, ...office.doors].map((c) => `${c.x},${c.y}`));
  const walls = [...office.innerWalls];
  const add = (x: number, y: number) => {
    const key = `${x},${y}`;
    if (taken.has(key)) return;
    taken.add(key);
    walls.push({ x, y });
  };
  const bottomRow = h - ANNEX_DEPTH;
  const sideRows = office.annexes.includes('bottom') ? bottomRow - 1 : h;
  if (office.annexes.includes('right')) for (let y = 1; y <= sideRows; y++) add(w - ANNEX_DEPTH, y);
  if (office.annexes.includes('left')) for (let y = 1; y <= sideRows; y++) add(ANNEX_STEP, y);
  if (office.annexes.includes('bottom')) for (let x = 1; x <= w; x++) add(x, bottomRow);
  return { ...office, innerWalls: walls };
};

// 辺を広げる。右と左は幅、下は高さを step マス増やす。左に広げたときは、置いてあるものの座標をずらして同じ見た目の位置に保つ。
// 別室があれば、その仕切りの壁も新しい床の分だけ延ばす（ドアは動かさない）
const growOffice = (office: Office, side: ExpandSide, step: number): Office => {
  const size = expandedSizeOf(office.size, side, step);
  const moved = shiftOffice(office, side === 'left' ? step : 0);
  return sealAnnexes({ ...moved, size });
};

// 辺の外に別室を足す。仕切りの壁（外壁だった列・行）と、その先に奥行き ANNEX_DEPTH マスの床を足す。
// 仕切りの真ん中に1マスのドアを置く。左に足すときは、既存のものを右へずらす
const annexOffice = (office: Office, side: ExpandSide): Office => {
  const { w, h } = office.size;
  const base = side === 'left' ? shiftOffice(office, ANNEX_STEP) : office;
  const door: OfficeCell =
    side === 'bottom' ? { x: 1 + Math.floor((w - 1) / 2), y: h + 1 } : { x: side === 'right' ? w + 1 : ANNEX_STEP, y: 1 + Math.floor((h - 1) / 2) };
  return sealAnnexes({
    ...base,
    size: expandedSizeOf(office.size, side, ANNEX_STEP),
    doors: [...base.doors, door],
    annexes: [...base.annexes, side],
  });
};

// 自社オフィスの辺を買って広げる。費用は資金から引く。辺の上限に達していれば別室を足す
export const expandOffice = (core: Core, side: ExpandSide, config: OfficeConfig): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  const office = core.office;
  const action = expandActionOf(office, side, config);
  if (action === null) return fail('max');
  const cost = officeExpandCostOf(office, config);
  if (core.clock.money < cost) return fail('money');
  const next = action === 'annex' ? annexOffice(office, side) : growOffice(office, side, config.expand.step);
  return { ok: true, core: { ...core, clock: { ...core.clock, money: core.clock.money - cost }, office: next } };
};
