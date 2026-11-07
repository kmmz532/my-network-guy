// ゲームデータから、案件の流れと判定に使う環境を作る（実行時のみ使用）。
import { balance, cables as cableRecord, devices as deviceRecord, furniture as furnitureRecord } from 'virtual:game-data';
import { isPcIn, type Env } from './project';
import { tileKind } from '../data/tileKind';
import type { GameMap } from '../data/schema';

const devices: Env['devices'] = Object.fromEntries(
  Object.values(deviceRecord).map((d) => [
    d.id,
    {
      category: d.category,
      price: d.price,
      portCount: d.ports.reduce((sum, p) => sum + p.count, 0),
      // 口の種類を、口の番号の順に並べる（rj45 の口の後に sfp の口）
      portTypes: d.ports.flatMap((p) => Array.from({ length: p.count }, () => p.type)),
      deskable: d.deskable,
      defaultServices: d.defaultServices,
    },
  ]),
);

const cables: Env['cables'] = Object.fromEntries(
  Object.values(cableRecord).map((c) => [
    c.id,
    { port: c.port, pricePerLink: c.pricePerLink, pricePerTile: c.pricePerTile, maxLengthTiles: c.maxLengthTiles },
  ]),
);

export const gameEnv: Env = {
  balance,
  furniture: furnitureRecord,
  devices,
  cables,
  engine: {
    categoryOf: (device) => devices[device]?.category ?? 'unknown',
    maxLengthOf: (cable) => cables[cable]?.maxLengthTiles ?? 0,
  },
};

// 機器の種類が PC かどうか（N102）
export const isPcDevice = (device: string): boolean => isPcIn(gameEnv, device);

// 地図の壁のマスを、電波の減衰の判定に渡す（N151）。壁（wall）だけを数え、ドアは通す。地図がないときは壁なし
export const engineWithWalls = (engine: Env['engine'], map: GameMap | undefined): Env['engine'] =>
  map ? { ...engine, wallAt: (x, y) => tileKind(map, x, y) === 'wall' } : engine;
