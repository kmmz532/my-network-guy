// 機材の価格の式（N35）。基本の価格（分類）＋ポート1つあたり（分類）×ポートの数＋機能ごとの加算。
// 機材の定価（devices/*.json の price）は、この式の値と一致させる（pricing.test.ts が確かめる）。
import type { Balance } from '../data/schema';

export interface PriceInput {
  category: string;
  // ポートの数（すべての口）
  ports: number;
  features: readonly string[];
}

export const priceOf = (input: PriceInput, pricing: Balance['pricing']): number => {
  const base = pricing.base[input.category];
  const perPort = pricing.perPort[input.category];
  if (base === undefined || perPort === undefined) throw new Error(`価格の式に分類 ${input.category} がない`);
  let price = base + perPort * input.ports;
  for (const f of input.features) {
    const add = pricing.features[f];
    if (add === undefined) throw new Error(`価格の式に機能 ${f} がない`);
    price += add;
  }
  return price;
};
