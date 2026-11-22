// 定型案件の置く範囲と、配線の中心。予算の計算（budget.ts）と案件の生成（template.ts）が共用する。
import type { ContractTemplate, GameMap } from '../data/schema';
import { tileKind } from '../data/tileKind';

// スイッチを1台置いて、全機器と配線するときの配線の長さ（タイル数の合計）が最も短い置き場所。床のマスで、機器のないマスから選ぶ。
// reach を渡すと、すべての機器までの距離が reach 以下のマスを優先する（ケーブルの上限長に収まる。そのようなマスがなければ、制限なしで選ぶ）。
// blocked は、機器を置けないマス（家具）。地図の固定の家具も除く
export const starHubOf = (
  points: readonly { x: number; y: number }[],
  map: GameMap,
  reach?: number,
  blocked: readonly { x: number; y: number }[] = [],
): { x: number; y: number; tiles: number } => {
  let best: { x: number; y: number; tiles: number } | null = null;
  let bestReach: { x: number; y: number; tiles: number } | null = null;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (tileKind(map, x, y) !== 'floor') continue;
      if (points.some((p) => p.x === x && p.y === y)) continue;
      if (blocked.some((b) => b.x === x && b.y === y) || (map.furniture ?? []).some((f) => f.x === x && f.y === y)) continue;
      const tiles = points.reduce((sum, p) => sum + Math.abs(p.x - x) + Math.abs(p.y - y), 0);
      if (best === null || tiles < best.tiles) best = { x, y, tiles };
      if (reach !== undefined && points.every((p) => Math.abs(p.x - x) + Math.abs(p.y - y) <= reach) && (bestReach === null || tiles < bestReach.tiles)) bestReach = { x, y, tiles };
    }
  }
  const found = bestReach ?? best;
  if (found === null) throw new Error('床のマスがない');
  return found;
};

// 置く範囲の組（spawnGroups。spawnArea のときは1つのグループ）
export interface SpawnGroup { x: number; y: number; width: number; height: number; min: number; max: number; role?: string; name?: string; subnet?: number }

export const spawnGroupsOf = (template: ContractTemplate): SpawnGroup[] => {
  if (template.spawnGroups !== undefined) return template.spawnGroups;
  if (template.spawnArea === undefined || template.params === undefined) {
    throw new Error(`${template.id}: spawnArea と params.pcCount が必要`);
  }
  const { x, y, width, height } = template.spawnArea;
  return [{ x, y, width, height, min: template.params.pcCount.min, max: template.params.pcCount.max }];
};

// 台数の範囲（全グループの合計）
export const pcCountRangeOf = (template: ContractTemplate): { min: number; max: number } => {
  const groups = spawnGroupsOf(template);
  return { min: groups.reduce((s, g) => s + g.min, 0), max: groups.reduce((s, g) => s + g.max, 0) };
};
