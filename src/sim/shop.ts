// ショップの陳列と購入の判定。解禁は会社のレベル（品目の unlockLevel。N45）で決まる。
import type { ShopItem } from '../data/schema';

// 品目の解放のレベル（機器・ケーブル・家具の定義から）。定義がなければ例外（R5）
export interface ItemDefs {
  devices: Readonly<Record<string, { unlockLevel: number }>>;
  furniture: Readonly<Record<string, { unlockLevel: number }>>;
  cables: Readonly<Record<string, { unlockLevel: number }>>;
}

export const unlockLevelOfItem = (item: ShopItem, defs: ItemDefs): number => {
  if (item.device !== undefined) {
    const d = defs.devices[item.device];
    if (!d) throw new Error(`unknown shop device: ${item.device}`);
    return d.unlockLevel;
  }
  if (item.furniture !== undefined) {
    const f = defs.furniture[item.furniture];
    if (!f) throw new Error(`unknown shop furniture: ${item.furniture}`);
    return f.unlockLevel;
  }
  if (item.cable !== undefined) {
    const c = defs.cables[item.cable];
    if (!c) throw new Error(`unknown shop cable: ${item.cable}`);
    return c.unlockLevel;
  }
  throw new Error('shop item without a target');
};

// 店に並べるか（会社のレベルが解放のレベル以上。サンドボックスは全部）
export const isUnlocked = (item: ShopItem, level: number, defs: ItemDefs, sandbox = false): boolean => {
  // サンドボックス専用の品目は、サンドボックスの中だけに並ぶ（経営モードの解放のレベルは見ない）
  if (item.sandboxOnly) return sandbox;
  return sandbox || unlockLevelOfItem(item, defs) <= level;
};

export type BuyResult = { ok: true; money: number; owned: Record<string, number> } | { ok: false; reason: 'money' };

// 機材を1台購入する。資金が足りなければ何も変えない
export const buyDevice = (
  money: number,
  owned: Record<string, number>,
  deviceId: string,
  price: number,
): BuyResult => {
  if (money < price) return { ok: false, reason: 'money' };
  return { ok: true, money: money - price, owned: { ...owned, [deviceId]: (owned[deviceId] ?? 0) + 1 } };
};

export type SellResult = { ok: true; money: number; owned: Record<string, number> } | { ok: false; reason: 'stock' };

// 在庫を1台売る。売値は購入時の値段に rate を掛けた額（円未満は切り捨て）。在庫がなければ何も変えない
export const sellDevice = (
  money: number,
  owned: Record<string, number>,
  deviceId: string,
  price: number,
  rate: number,
): SellResult => {
  const count = owned[deviceId] ?? 0;
  if (count <= 0) return { ok: false, reason: 'stock' };
  const next = { ...owned, [deviceId]: count - 1 };
  return { ok: true, money: money + Math.floor(price * rate), owned: next };
};
