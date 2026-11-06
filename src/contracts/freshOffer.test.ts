// 新しく解放した種類の重み（LEVEL.md 10.4。N51b）: 解放から arrivals 件届くまで weightFactor 倍で出る
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import mapJson from '../assets/data/maps/office_small.json';
import type { Balance, ContractTemplate, GameMap } from '../data/schema';
import { refreshOffers, type OfferEnv, type OfferState } from './offers';
import templateJson from '../assets/data/contracts/templates/t_small_lan.json';

const map = mapJson as unknown as GameMap;
const base = templateJson as unknown as ContractTemplate;
// 同じ条件の2つのひな形。A だけ新しく解放した種類（announce）として数える
const fresh = { ...base, id: 'fresh_a', textId: 'fresh_a', announce: true, weight: 10, unlockLevel: 1, requires: [] } as ContractTemplate;
const other = { ...base, id: 'fresh_b', textId: 'fresh_b', announce: true, weight: 10, unlockLevel: 1, requires: [] } as ContractTemplate;
const env: OfferEnv = {
  balance: balanceJson as unknown as Balance,
  fixed: [],
  templates: [fresh, other],
  mapOf: (id) => (id === 'office_small' ? map : undefined),
};

// 届く依頼のうち、A の割合（乱数の種を変えて多数回）
const shareOf = (arrivals: number): number => {
  let a = 0;
  const N = 400;
  for (let seed = 1; seed <= N; seed++) {
    const state: OfferState = {
      minute: 0,
      companyExp: 0,
      completed: [],
      offers: [],
      excluded: [],
      nextOfferMinute: 0,
      offerSeq: 0,
      // B は規定の件数に達している（重みは元に戻る）
      newArrivals: { fresh_a: arrivals, fresh_b: 2 },
      rng: seed,
    } as OfferState;
    const next = refreshOffers(state, env);
    if (next.offers[0]?.baseId === 'fresh_a') a++;
  }
  return a / N;
};

describe('新しく解放した種類の重み', () => {
  it('解放から届いた件数が少ないうちは、重みが倍になって多く出る', () => {
    const boosted = shareOf(0);
    const plain = shareOf(2);
    expect(boosted).toBeGreaterThan(plain + 0.15);
    expect(plain).toBeGreaterThan(0.35);
    expect(plain).toBeLessThan(0.65);
  });

  it('届いた件数が規定に達すると、重みは元に戻る', () => {
    expect(shareOf(2)).toBeLessThan(0.6);
  });
});
