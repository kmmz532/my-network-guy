// 依頼の追加。一定の間隔ごとに、固定案件（前提を満たした最初の1件）か定型案件を追加する。
// 設定（offerBurst）があれば、ときどき2件以上まとめて届く。
import type { Balance, Contract, ContractTemplate, GameMap } from '../data/schema';
import { minutesPerDay } from '../sim/clock';
import { rand } from '../sim/rng';
import { instantiateTemplate, pickByWeight, type Offer } from './template';

export const MAX_OFFERS = 30;

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

// 依頼を1件追加する。追加できなければ、同じ状態を返す。
const addOffer = (state: OfferState, env: OfferEnv): OfferState => {
  const taken = (baseId: string) =>
    state.completed.includes(baseId) ||
    state.excluded.includes(baseId) ||
    state.offers.some((o) => o.baseId === baseId);
  const ready = (requires: readonly string[]) => requires.every((r) => state.completed.includes(r));

  // 固定案件を優先する（並び順は読み込み時に確定している）
  const fixed = env.fixed.find((c) => !taken(c.id) && ready(c.requires));
  if (fixed) {
    return {
      ...state,
      offers: [...state.offers, { id: fixed.id, kind: 'fixed', baseId: fixed.id, params: {}, contract: fixed }],
    };
  }

  // 定型案件: 前提と評判を満たし、地図が読み込まれているひな形から重みで選ぶ
  const eligible = env.templates.filter(
    (t) => ready(t.requires) && state.reputation >= t.minReputation && env.mapOf(t.map) !== undefined,
  );
  if (eligible.length === 0) return state;
  const picked = pickByWeight(eligible, state.rng);
  const map = env.mapOf(picked.item.map);
  if (!map) return state;
  const made = instantiateTemplate(picked.item, map, state.offerSeq, picked.rng);
  return {
    ...state,
    offers: [...state.offers, made.offer],
    offerSeq: state.offerSeq + 1,
    rng: made.rng,
  };
};

export const refreshOffers = (state: OfferState, env: OfferEnv): OfferState => {
  if (state.minute < state.nextOfferMinute) return state;
  const interval = env.balance.offerIntervalDays * minutesPerDay;
  let next: OfferState = { ...state, nextOfferMinute: state.nextOfferMinute + interval };
  if (state.offers.length >= MAX_OFFERS) return next;

  // まとめて届くかを、確率で決める（設定がなければ、毎回1件だけ）
  let count = 1;
  const burst = env.balance.offerBurst;
  if (burst) {
    const roll = rand(next.rng);
    next = { ...next, rng: roll.state };
    if (roll.value < burst.chance) {
      // 2件から上限までの間で件数を決める
      const size = rand(next.rng);
      next = { ...next, rng: size.state };
      count = 2 + Math.floor(size.value * (burst.count - 1));
    }
  }

  for (let i = 0; i < count && next.offers.length < MAX_OFFERS; i++) {
    const added = addOffer(next, env);
    if (added === next) break;
    next = added;
  }
  return next;
};
