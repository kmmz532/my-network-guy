// 依頼の追加。一定の間隔ごとに、固定案件（前提を満たした最初の1件）か定型案件を1件追加する。
import type { Balance, Contract, ContractTemplate, GameMap } from '../data/schema';
import { minutesPerDay } from '../sim/clock';
import { instantiateTemplate, pickByWeight, type Offer } from './template';

export const MAX_OFFERS = 3;

export interface OfferState {
  minute: number;
  reputation: number;
  completed: readonly string[];
  offers: readonly Offer[];
  // 受注中の案件の baseId。受注中の案件は依頼に出さない
  excluded: readonly string[];
  nextOfferMinute: number;
  offerSeq: number;
  rng: number;
}

export interface OfferEnv {
  balance: Balance;
  fixed: readonly Contract[];
  templates: readonly ContractTemplate[];
  mapOf: (id: string) => GameMap | undefined;
}

export const refreshOffers = (state: OfferState, env: OfferEnv): OfferState => {
  if (state.minute < state.nextOfferMinute) return state;
  const interval = env.balance.offerIntervalDays * minutesPerDay;
  const next = { ...state, nextOfferMinute: state.nextOfferMinute + interval };
  if (state.offers.length >= MAX_OFFERS) return next;

  const taken = (baseId: string) =>
    state.completed.includes(baseId) ||
    state.excluded.includes(baseId) ||
    state.offers.some((o) => o.baseId === baseId);
  const ready = (requires: readonly string[]) => requires.every((r) => state.completed.includes(r));

  // 固定案件を優先する（並び順は読み込み時に確定している）
  const fixed = env.fixed.find((c) => !taken(c.id) && ready(c.requires));
  if (fixed) {
    return {
      ...next,
      offers: [...state.offers, { id: fixed.id, kind: 'fixed', baseId: fixed.id, params: {}, contract: fixed }],
    };
  }

  // 定型案件: 前提と評判を満たし、地図が読み込まれているひな形から重みで選ぶ
  const eligible = env.templates.filter(
    (t) => ready(t.requires) && state.reputation >= t.minReputation && env.mapOf(t.map) !== undefined,
  );
  if (eligible.length === 0) return next;
  const picked = pickByWeight(eligible, state.rng);
  const map = env.mapOf(picked.item.map);
  if (!map) return next;
  const made = instantiateTemplate(picked.item, map, state.offerSeq, picked.rng);
  return {
    ...next,
    offers: [...state.offers, made.offer],
    offerSeq: state.offerSeq + 1,
    rng: made.rng,
  };
};
