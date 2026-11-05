// 自社オフィスの部屋の大きさと広げ方（純粋関数）。大きさからマップを作り、右・下・左の辺を買って広げる。
import type { Balance, GameMap } from '../data/schema';
import { officeLocked, type Core, type Office, type OfficeSize, type Outcome } from './project';

export type ExpandSide = 'right' | 'bottom' | 'left';
export type OfficeConfig = Balance['office'];

const fail = (reason: string): Outcome => ({ ok: false, reason });

// 奥の壁の窓。WINDOW_WIDTH マスの窓を、床の左端から WINDOW_PERIOD マスごとに置く（床の内側に収まるものだけ）
const WINDOW_PERIOD = 10;
const WINDOW_WIDTH = 2;
const TILE_SIZE = 32;

// 床の大きさから、部屋のマップを作る。奥の壁（上）に窓、手前の壁（下）と左右に壁、内側は床
export const officeMapOf = (size: OfficeSize): GameMap => {
  const width = size.w + 2;
  const height = size.h + 2;
  const back = Array.from({ length: width }, () => '#');
  for (let x = 1; x + WINDOW_WIDTH - 1 <= size.w; x += WINDOW_PERIOD) {
    for (let i = 0; i < WINDOW_WIDTH; i++) back[x + i] = 'W';
  }
  const row = `#${'.'.repeat(size.w)}#`;
  const tiles = [back.join(''), ...Array.from({ length: size.h }, () => row), '#'.repeat(width)];
  return { id: 'hq', width, height, tileSize: TILE_SIZE, legend: { '.': 'floor', '#': 'wall', W: 'window' }, tiles };
};

// 広げた回数。床の増えた分（step マスずつ）から数える。新しく始めた部屋は0回
export const expandCountOf = (size: OfficeSize, initial: OfficeSize, step: number): number =>
  Math.max(0, Math.floor((size.w - initial.w + (size.h - initial.h)) / step));

// 次に広げる費用（円）。baseCost から、広げた回数ごとに growth 倍になる
export const expandCostOf = (size: OfficeSize, config: OfficeConfig): number =>
  Math.round(config.expand.baseCost * config.expand.growth ** expandCountOf(size, config.initialSize, config.expand.step));

// 辺を広げたあとの床の大きさ。右と左は幅、下は高さが step マス増える
export const expandedSizeOf = (size: OfficeSize, side: ExpandSide, step: number): OfficeSize =>
  side === 'bottom' ? { w: size.w, h: size.h + step } : { w: size.w + step, h: size.h };

// 上限（maxSize）を超えないか
export const canExpand = (size: OfficeSize, side: ExpandSide, config: OfficeConfig): boolean => {
  const next = expandedSizeOf(size, side, config.expand.step);
  return next.w <= config.expand.maxSize.w && next.h <= config.expand.maxSize.h;
};

// 機器・家具・ケーブルの座標を dx だけずらす（左に広げたときに使う）
const shiftOffice = (office: Office, dx: number): Office => ({
  ...office,
  nodes: office.nodes.map((n) => ({ ...n, x: n.x + dx })),
  furniture: office.furniture.map((f) => ({ ...f, x: f.x + dx })),
  links: office.links.map((l) => ({ ...l, path: l.path.map(([x, y]) => [x + dx, y] as [number, number]) })),
});

// 自社オフィスの辺を買って広げる。費用は資金から引く。左に広げたときは、置いてあるものの座標をずらして同じ見た目の位置に保つ
export const expandOffice = (core: Core, side: ExpandSide, config: OfficeConfig): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  const office = core.office;
  if (!canExpand(office.size, side, config)) return fail('max');
  const cost = expandCostOf(office.size, config);
  if (core.clock.money < cost) return fail('money');
  const size = expandedSizeOf(office.size, side, config.expand.step);
  const moved = shiftOffice(office, side === 'left' ? config.expand.step : 0);
  return {
    ok: true,
    core: { ...core, clock: { ...core.clock, money: core.clock.money - cost }, office: { ...moved, size } },
  };
};
