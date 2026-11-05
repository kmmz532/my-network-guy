// 倉庫の欄に並べる品目の判定。今の画面で置ける在庫だけを返す（UX.md「6. ショップと倉庫」）
import type { ShopItem } from '../data/schema';
import { isUnlocked } from './shop';

// 自社オフィス（案件なし）、案件の設計中、それ以外（施工中・検収中・納品の結果）
export type WarehouseMode = 'office' | 'design' | 'closed';

export interface WarehouseItem {
  kind: 'device' | 'furniture';
  id: string;
}

// 受注中の案件の段階と、納品の結果を表示しているかで画面の状態を決める
export const warehouseMode = (activePhase: 'design' | 'build' | null, showcase: boolean): WarehouseMode => {
  if (activePhase === 'design') return 'design';
  if (activePhase === 'build' || showcase) return 'closed';
  return 'office';
};

// 欄に並べる品目。解禁済みで在庫が1つ以上のものだけ。設計中は家具を並べない
export const warehouseItems = (
  mode: WarehouseMode,
  shop: readonly ShopItem[],
  completed: readonly string[],
  owned: Record<string, number>,
  sandbox = false,
): WarehouseItem[] => {
  if (mode === 'closed') return [];
  const unlocked = shop.filter((item) => isUnlocked(item, completed, sandbox));
  const devices: WarehouseItem[] = unlocked.filter((i) => i.device).map((i) => ({ kind: 'device', id: i.device! }));
  const furniture: WarehouseItem[] =
    mode === 'office' ? unlocked.filter((i) => i.furniture).map((i) => ({ kind: 'furniture', id: i.furniture! })) : [];
  return [...devices, ...furniture].filter((item) => (owned[item.id] ?? 0) > 0);
};
