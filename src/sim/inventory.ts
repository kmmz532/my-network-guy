// インベントリの欄に並べる品目の判定。持っている数が1以上の機器・家具をすべて並べる（店の解放は店で買えるかだけに使う。B1）
// 同じ数の持ち物から、画面の並びは決まる。
import { inventoryCatalogOf, type Catalog } from './catalog';

// 自社オフィス（案件なし）、案件の設計中、それ以外（施工中・検収中・納品の結果）
export type InventoryMode = 'office' | 'design' | 'closed';

export interface InventoryItem {
  kind: 'device' | 'furniture';
  id: string;
  // 今は使えない理由（使えるなら省く）。設計中の家具は、一覧に残して使えないと示す（N・インベントリ）
  blocked?: 'design';
}

// 受注中の案件の段階と、納品の結果を表示しているかで画面の状態を決める
export const inventoryMode = (activePhase: 'design' | 'build' | null, showcase: boolean): InventoryMode => {
  if (activePhase === 'design') return 'design';
  if (activePhase === 'build' || showcase) return 'closed';
  return 'office';
};

// 欄に並べる品目。機材を先、家具を後に並べる（店の並び順。店にないものは、その後に ID の順）。設計中の家具は並べたうえで使えない印を付ける（自社オフィスの家具は、設計中は置けない）。
// 定義（機材・家具）にない ID を持っていたら例外にする（黙って消さない。R5）
// sandbox のときは、解放済みの全品目（店の並び順のすべて）を並べる（在庫の数は使わない）
export const inventoryItems = (mode: InventoryMode, owned: Record<string, number>, catalog: Catalog, sandbox = false): InventoryItem[] => {
  if (mode === 'closed') return [];
  const held = sandbox
    ? catalog.shopOrder.filter((id) => id in catalog.devices || id in catalog.furniture)
    : Object.entries(owned).filter(([, n]) => n > 0).map(([id]) => id);
  const { devices, furniture } = inventoryCatalogOf(held, catalog);
  const asDevices: InventoryItem[] = devices.map((id) => ({ kind: 'device', id }));
  const asFurniture: InventoryItem[] = furniture.map((id) => (mode === 'design' ? { kind: 'furniture', id, blocked: 'design' } : { kind: 'furniture', id }));
  return [...asDevices, ...asFurniture];
};
