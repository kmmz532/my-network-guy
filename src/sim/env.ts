// ゲームデータから、案件の流れと判定に使う環境を作る（実行時のみ使用）。
import { balance, cables as cableRecord, devices as deviceRecord, furniture as furnitureRecord } from 'virtual:game-data';
import type { Env } from './project';

const devices: Env['devices'] = Object.fromEntries(
  Object.values(deviceRecord).map((d) => [
    d.id,
    {
      category: d.category,
      price: d.price,
      portCount: d.ports.reduce((sum, p) => sum + p.count, 0),
      deskable: d.deskable,
      defaultServices: d.defaultServices,
    },
  ]),
);

const cables: Env['cables'] = Object.fromEntries(
  Object.values(cableRecord).map((c) => [
    c.id,
    { pricePerLink: c.pricePerLink, pricePerTile: c.pricePerTile, maxLengthTiles: c.maxLengthTiles },
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
