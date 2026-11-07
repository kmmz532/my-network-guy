// 地図の壁を電波の減衰に渡す（N151）。壁（wall）のマスだけを数え、ドアは通す。地図がないときは壁なし
import type { GameMap } from '../data/schema';
import { tileKind } from '../data/tileKind';
import type { EngineData } from '../network/types';

export const engineWithWalls = (engine: EngineData, map: GameMap | undefined): EngineData =>
  map ? { ...engine, wallAt: (x, y) => tileKind(map, x, y) === 'wall' } : engine;
