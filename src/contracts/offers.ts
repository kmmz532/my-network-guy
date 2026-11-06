// 依頼の追加。一定の間隔ごとに、固定案件（前提を満たした最初の1件）か定型案件を追加する。
// 設定（offerBurst）があれば、ときどき2件以上まとめて届く。
import type { Balance, Contract, ContractTemplate, GameMap } from '../data/schema';
import { minutesPerDay } from '../sim/clock';
import { rand } from '../sim/rng';
import { instantiateTemplate, pickByWeight, type Offer } from './template';
import { randInt } from '../sim/rng';
import type { OfferSort } from '../settings/settings';

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

const isTaken = (state: OfferState, baseId: string): boolean =>
  state.completed.includes(baseId) || state.excluded.includes(baseId) || state.offers.some((o) => o.baseId === baseId);
const isReady = (state: OfferState, requires: readonly string[]): boolean => requires.every((r) => state.completed.includes(r));

// 届く条件（前提・評判）をそろえているのに、地図が読み込まれていないひな形を、開発中に1度ずつ警告する
const warnedMaps = new Set<string>();
const warnMissingMaps = (state: OfferState, env: OfferEnv): void => {
  if (!import.meta.env.DEV) return;
  for (const t of env.templates) {
    if (env.mapOf(t.map) !== undefined || warnedMaps.has(t.map)) continue;
    if (!t.requires.every((r) => state.completed.includes(r)) || state.reputation < t.minReputation) continue;
    warnedMaps.add(t.map);
    console.warn(`定型案件 ${t.id} の地図 ${t.map} が読み込まれていないため、依頼に出ない`);
  }
};

// 依頼を1件追加する。追加できなければ、同じ状態を返す。
const addOffer = (state: OfferState, env: OfferEnv): OfferState => {
  const taken = (baseId: string) => isTaken(state, baseId);
  const ready = (requires: readonly string[]) => isReady(state, requires);

  // 固定案件を優先する（並び順は読み込み時に確定している）
  const fixed = env.fixed.find((c) => !taken(c.id) && ready(c.requires));
  if (fixed) {
    return {
      ...state,
      offers: [...state.offers, { id: fixed.id, kind: 'fixed', baseId: fixed.id, params: {}, contract: fixed, arrivedMinute: state.minute }],
    };
  }

  // 定型案件: 前提と評判を満たし、地図が読み込まれているひな形から重みで選ぶ
  const eligible = env.templates.filter(
    (t) => ready(t.requires) && state.reputation >= t.minReputation && env.mapOf(t.map) !== undefined,
  );
  // 地図が読み込まれていないひな形は、依頼から外れる（黙って外さない。開発中は警告する）
  warnMissingMaps(state, env);
  if (eligible.length === 0) return state;
  const picked = pickByWeight(eligible, state.rng);
  const map = env.mapOf(picked.item.map);
  if (!map) return state;
  const made = instantiateTemplate(picked.item, map, state.offerSeq, picked.rng);
  // 受注できる期限は、ひな形の範囲から乱数で決める（範囲がなければ期限はない）
  let rng = made.rng;
  let offer: Offer = { ...made.offer, arrivedMinute: state.minute };
  const span = picked.item.offerExpireDays;
  if (span) {
    const days = randInt(rng, span.min, span.max);
    rng = days.state;
    offer = { ...offer, expiresMinute: state.minute + days.value * minutesPerDay };
  }
  return {
    ...state,
    offers: [...state.offers, offer],
    offerSeq: state.offerSeq + 1,
    rng,
  };
};

export const refreshOffers = (state0: OfferState, env: OfferEnv): OfferState => {
  // 期限を過ぎた依頼は消す（時間が進むたびに見る）
  const live = state0.offers.filter((o) => o.expiresMinute === undefined || state0.minute < o.expiresMinute);
  const state = live.length === state0.offers.length ? state0 : { ...state0, offers: live };
  if (state.minute < state.nextOfferMinute) return state;
  const interval = env.balance.offerIntervalDays * minutesPerDay;
  let next: OfferState = { ...state, nextOfferMinute: state.nextOfferMinute + interval };

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

  for (let i = 0; i < count; i++) {
    const added = addOffer(next, env);
    if (added === next) break;
    next = added;
  }
  // 上限を超えたら、古いものから消す（新しい依頼は必ず届く）
  if (next.offers.length > MAX_OFFERS) next = { ...next, offers: next.offers.slice(next.offers.length - MAX_OFFERS) };
  return next;
};

// 次の依頼が届かない理由。届く見込みがあるなら null（reason は null のまま）
export type OfferBlock =
  | { kind: 'reputation'; need: number }
  | { kind: 'fixed'; after: string };

export interface OfferHint {
  // 次の依頼まで、何日か（1日未満は1日）
  days: number;
  block: OfferBlock | null;
}

// 依頼の一覧に出す案内。次の依頼までの日数と、届かない理由（あれば）
export const offerHint = (state: OfferState, env: OfferEnv): OfferHint => {
  const days = Math.max(1, Math.ceil((state.nextOfferMinute - state.minute) / minutesPerDay));
  const fixedLeft = env.fixed.filter((c) => !isTaken(state, c.id));
  if (fixedLeft.some((c) => isReady(state, c.requires))) return { days, block: null };
  const loadable = env.templates.filter((t) => isReady(state, t.requires) && env.mapOf(t.map) !== undefined);
  if (loadable.some((t) => state.reputation >= t.minReputation)) return { days, block: null };
  if (loadable.length > 0) {
    return { days, block: { kind: 'reputation', need: Math.min(...loadable.map((t) => t.minReputation)) } };
  }
  // 定型案件がなく、固定案件の前提も未達なら、最初の固定案件の前提を示す
  const next = fixedLeft[0];
  if (next) {
    const after = next.requires.find((r) => !state.completed.includes(r));
    if (after) return { days, block: { kind: 'fixed', after } };
  }
  return { days, block: null };
};

// 依頼の一覧の並べ方。新しい順（届いた時刻が新しい順）・期限の近い順（期限がないものは後ろ）・報酬の高い順
export const sortOffers = (offers: readonly Offer[], mode: OfferSort): Offer[] => {
  // 同じ値のときは、新しく届いたものを上にする（配列の後ろほど新しい）
  const newestFirst = [...offers].reverse();
  if (mode === 'deadline') return newestFirst.sort((a, b) => (a.expiresMinute ?? Infinity) - (b.expiresMinute ?? Infinity));
  if (mode === 'reward') return newestFirst.sort((a, b) => b.contract.reward.money - a.contract.reward.money);
  return newestFirst.sort((a, b) => (b.arrivedMinute ?? 0) - (a.arrivedMinute ?? 0));
};

// 定型案件の依頼を断る。固定案件は断れない（同じ一覧を返す）
export const declineOffer = (offers: readonly Offer[], id: string): Offer[] =>
  offers.filter((o) => !(o.id === id && o.kind === 'template'));
