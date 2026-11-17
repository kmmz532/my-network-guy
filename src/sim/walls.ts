// 地図の壁を電波の減衰に、置いた家具の干渉源を電波の干渉に渡す。壁（wall）のマスだけを数え、ドアは通す。地図がないときは壁なし
import type { GameMap } from '../data/schema';
import { tileKind } from '../data/tileKind';
import type { EngineData } from '../network/types';
import { isInterferenceSource } from '../registry/wireless';
import { furnitureOf } from '../contracts/layout';
import type { PlacedFurniture } from './project';

// 案件の地図に置かれた家具。自社の案件は、自社オフィスの家具
export const siteFurnitureOf = (
  contract: { inhouse?: boolean; furniture?: readonly { id: string; x: number; y: number }[] },
  map: GameMap | undefined,
  office: readonly PlacedFurniture[],
): readonly { id: string; x: number; y: number }[] => (contract.inhouse ? office : furnitureOf(map?.furniture, contract.furniture));

export const engineWithSite = (engine: EngineData, map: GameMap | undefined, furniture: readonly { id: string; x: number; y: number }[]): EngineData => ({
  ...engine,
  ...(map ? { wallAt: (x: number, y: number) => tileKind(map, x, y) === 'wall' } : {}),
  interferers: furniture.filter((f) => isInterferenceSource(f.id)).map((f) => ({ x: f.x, y: f.y })),
});
