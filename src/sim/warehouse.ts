// 倉庫の欄に並べる品目の判定。持っている数が1以上の機器・家具をすべて並べる（店の解放は店で買えるかだけに使う。B1）
// 同じ数の持ち物から、画面の並びは決まる。
import { warehouseCatalogOf, type Catalog } from './catalog';

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

// 欄に並べる品目。機材を先、家具を後に並べる（店の並び順。店にないものは、その後に ID の順）。設計中は家具を並べない。
// 定義（機材・家具）にない ID を持っていたら例外にする（黙って消さない。R5）
export const warehouseItems = (mode: WarehouseMode, owned: Record<string, number>, catalog: Catalog): WarehouseItem[] => {
  if (mode === 'closed') return [];
  const held = Object.entries(owned).filter(([, n]) => n > 0).map(([id]) => id);
  const { devices, furniture } = warehouseCatalogOf(held, catalog);
  const asDevices: WarehouseItem[] = devices.map((id) => ({ kind: 'device', id }));
  const asFurniture: WarehouseItem[] = mode === 'office' ? furniture.map((id) => ({ kind: 'furniture', id })) : [];
  return [...asDevices, ...asFurniture];
};
