// ゲーム全体の状態。時間・資金・評判・在庫・完了案件・依頼・速度を持ち、Tick ごとに進める。
import { create } from 'zustand';
import { balance, contracts, contractTemplates, devices } from 'virtual:game-data';
import { advanceTick, initialClock, type ClockState } from '../sim/clock';
import { buyDevice } from '../sim/shop';
import { refreshOffers, type OfferEnv } from '../contracts/offers';
import type { Offer } from '../contracts/template';
import type { GameMap } from '../data/schema';
import type { SaveData } from '../services/migrations';

export type Speed = 0 | 1 | 2 | 4;

export interface GameState {
  clock: ClockState;
  reputation: number;
  owned: Record<string, number>;
  completed: string[];
  offers: Offer[];
  nextOfferMinute: number;
  offerSeq: number;
  rng: number;
  speed: Speed;
  // 読み込み済みのマップ（保存しない）
  maps: Record<string, GameMap>;
  tick: () => void;
  setSpeed: (speed: Speed) => void;
  cacheMap: (map: GameMap) => void;
  // 購入に成功したら true
  buy: (deviceId: string) => boolean;
  load: (save: SaveData) => void;
  snapshot: () => SaveData;
}

const env = (maps: Record<string, GameMap>): OfferEnv => ({
  balance,
  fixed: contracts,
  templates: contractTemplates,
  mapOf: (id) => maps[id],
});

const newRng = () => Math.floor(Math.random() * 0x7fffffff) + 1;

// 依頼の追加を1回分進める（時刻・評判・完了案件に応じる）
const refresh = (s: GameState): Partial<GameState> => {
  if (s.clock.bankrupt) return {};
  const r = refreshOffers(
    {
      minute: s.clock.minute,
      reputation: s.reputation,
      completed: s.completed,
      offers: s.offers,
      excluded: [],
      nextOfferMinute: s.nextOfferMinute,
      offerSeq: s.offerSeq,
      rng: s.rng,
    },
    env(s.maps),
  );
  return { offers: [...r.offers], nextOfferMinute: r.nextOfferMinute, offerSeq: r.offerSeq, rng: r.rng };
};

export const useGameStore = create<GameState>((set, get) => ({
  clock: initialClock(balance),
  reputation: 0,
  owned: {},
  completed: [],
  offers: [],
  nextOfferMinute: 0,
  offerSeq: 0,
  rng: newRng(),
  speed: 1,
  maps: {},
  tick: () =>
    set((s) => {
      const clock = advanceTick(s.clock, balance);
      return { clock, ...refresh({ ...s, clock }) };
    }),
  setSpeed: (speed) => set({ speed }),
  cacheMap: (map) => set((s) => ({ maps: { ...s.maps, [map.id]: map }, ...refresh({ ...s, maps: { ...s.maps, [map.id]: map } }) })),
  buy: (deviceId) => {
    const s = get();
    const result = buyDevice(s.clock.money, s.owned, deviceId, devices[deviceId as keyof typeof devices].price);
    if (!result.ok) return false;
    set({ clock: { ...s.clock, money: result.money }, owned: result.owned });
    return true;
  },
  load: (save) =>
    set({
      clock: save.clock,
      reputation: save.reputation,
      owned: save.owned,
      completed: save.completed,
      offers: save.offers as Offer[],
      nextOfferMinute: save.nextOfferMinute,
      offerSeq: save.offerSeq,
      rng: save.rng,
    }),
  snapshot: () => {
    const s = get();
    return {
      clock: s.clock,
      reputation: s.reputation,
      owned: s.owned,
      completed: s.completed,
      offers: s.offers,
      nextOfferMinute: s.nextOfferMinute,
      offerSeq: s.offerSeq,
      rng: s.rng,
    };
  },
}));
