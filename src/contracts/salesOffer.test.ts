// 営業の効果（依頼の到着の追加。報酬の高い依頼の重み）
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import mapJson from '../assets/data/maps/office_small.json';
import templateJson from '../assets/data/contracts/templates/t_small_lan.json';
import type { Balance, ContractTemplate, GameMap } from '../data/schema';
import { NO_OFFER_EFFECTS, refreshOffers, type OfferEnv, type OfferState } from './offers';

const map = mapJson as unknown as GameMap;
const base = templateJson as unknown as ContractTemplate;
const cheap = { ...base, id: 'cheap', textId: 'cheap', weight: 10, unlockLevel: 1, requires: [], reward: { ...base.reward, base: 1000 } } as ContractTemplate;
const rich = { ...base, id: 'rich', textId: 'rich', weight: 10, unlockLevel: 1, requires: [], reward: { ...base.reward, base: 100000 } } as ContractTemplate;
const env: OfferEnv = {
  balance: balanceJson as unknown as Balance,
  fixed: [],
  templates: [cheap, rich],
  mapOf: (id) => (id === 'office_small' ? map : undefined),
};
const state = (seed: number): OfferState =>
  ({ minute: 0, companyExp: 0, completed: [], offers: [], excluded: [], nextOfferMinute: 0, offerSeq: 0, newArrivals: {}, rng: seed }) as OfferState;

describe('営業の効果', () => {
  it('追加の到着の数だけ、依頼が増える（印つき）', () => {
    const next = refreshOffers(state(7), env, { extraArrivals: 2, rewardWeight: 0 });
    const plain = refreshOffers(state(7), env, NO_OFFER_EFFECTS);
    expect(next.offers.length).toBe(plain.offers.length + 2);
    expect(next.offers.filter((o) => (o as { fromSales?: true }).fromSales).length).toBe(2);
    expect(plain.offers.some((o) => (o as { fromSales?: true }).fromSales)).toBe(false);
  });

  it('報酬の高い依頼の重みが増えると、高い方が選ばれやすくなる', () => {
    const count = (w: number) => {
      let rich_n = 0;
      for (let seed = 1; seed <= 300; seed++) {
        const next = refreshOffers(state(seed), env, { extraArrivals: 0, rewardWeight: w });
        if (next.offers[0]?.baseId === 'rich') rich_n++;
      }
      return rich_n;
    };
    expect(count(3)).toBeGreaterThan(count(0));
  });
});
