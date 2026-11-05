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
