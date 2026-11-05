// ショップの陳列と購入の判定。解禁条件は案件の完了で判断する。
import type { ShopItem } from '../data/schema';

// サンドボックスでは解禁の条件を無視し、すべての品目を買える
export const isUnlocked = (item: ShopItem, completed: readonly string[], sandbox = false): boolean =>
  sandbox || !item.unlock || completed.includes(item.unlock.contract);

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
