// ゲーム全体の状態。時間・資金・評判・在庫・完了案件・依頼・受注中の案件・速度を持ち、Tick ごとに進める。
import { create } from 'zustand';
import { balance, contracts, contractTemplates, devices } from 'virtual:game-data';
import { advanceTick, initialClock, toDate, type ClockState } from '../sim/clock';
import { buyDevice } from '../sim/shop';
import { refreshOffers, type OfferEnv } from '../contracts/offers';
import type { Offer } from '../contracts/template';
import type { GameMap } from '../data/schema';
import type { SaveData } from '../services/migrations';
import { gameEnv } from '../sim/env';
import {
  abandon,
  accept,
  addRoute,
  removeRoute,
  advanceBuild,
  connect,
  placeDevice,
  removeNode,
  requestBuild,
  setGateway,
  setInterface,
  type Core,
  type Outcome,
  type Project,
  type Report,
} from '../sim/project';
import type { PathResult, Route } from '../network/types';
import { http as httpProbe, ping as pingProbe } from '../network/engine';

// 疎通テストの結果（保存しない）
export interface Trace {
  kind: 'ping' | 'http';
  src: string;
  dst: string;
  result: PathResult;
}

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
  active: Project | null;
  speed: Speed;
  // 読み込み済みのマップ（保存しない）
  maps: Record<string, GameMap>;
  // 直近の検収結果（保存しない）
  lastReport: Report | null;
  // 直近に失敗した操作の理由（保存しない）
  lastError: string | null;
  // 操作の状態（保存しない）
  selectedUid: string | null;
  // 配置モードで置く機材（null なら配置しない）
  placing: string | null;
  // 配線に使うケーブル
  wireCable: string;
  // 直近の疎通テスト
  lastTrace: Trace | null;
  probe: (kind: 'ping' | 'http', src: string, dst: string, port: number) => void;
  setSelected: (uid: string | null) => void;
  setPlacing: (deviceId: string | null) => void;
  setWireCable: (cableId: string) => void;
  tick: () => void;
  setSpeed: (speed: Speed) => void;
  cacheMap: (map: GameMap) => void;
  // 購入に成功したら true
  buy: (deviceId: string) => boolean;
  // 案件の流れの操作。失敗したら理由を返す（成功なら null）
  accept: (offerId: string) => string | null;
  place: (deviceId: string, x: number, y: number) => string | null;
  connect: (aUid: string, bUid: string, cableId: string) => string | null;
  removeNode: (uid: string) => string | null;
  setIface: (uid: string, port: number, ip: string) => string | null;
  setGateway: (uid: string, gateway: string | null) => string | null;
  addRoute: (uid: string, route: Route) => string | null;
  removeRoute: (uid: string, index: number) => string | null;
  requestBuild: () => string | null;
  abandon: () => string | null;
  load: (save: SaveData) => void;
  snapshot: () => SaveData;
}

const offerEnv = (maps: Record<string, GameMap>): OfferEnv => ({
  balance,
  fixed: contracts,
  templates: contractTemplates,
  mapOf: (id) => maps[id],
});

const newRng = () => Math.floor(Math.random() * 0x7fffffff) + 1;

const coreOf = (s: GameState): Core => ({
  clock: s.clock,
  reputation: s.reputation,
  owned: s.owned,
  completed: s.completed,
  offers: s.offers,
  active: s.active,
});

// 依頼の追加を1回分進める。受注中の案件と同じ依頼は出さない
const refresh = (s: GameState): Partial<GameState> => {
  if (s.clock.bankrupt) return {};
  const r = refreshOffers(
    {
      minute: s.clock.minute,
      reputation: s.reputation,
      completed: s.completed,
      offers: s.offers,
      excluded: s.active ? [s.active.baseId] : [],
      nextOfferMinute: s.nextOfferMinute,
      offerSeq: s.offerSeq,
      rng: s.rng,
    },
    offerEnv(s.maps),
  );
  return { offers: [...r.offers], nextOfferMinute: r.nextOfferMinute, offerSeq: r.offerSeq, rng: r.rng };
};

export const useGameStore = create<GameState>((set, get) => {
  // 案件の操作の結果を状態に反映する。失敗なら理由を返す
  const apply = (outcome: Outcome): string | null => {
    if (!outcome.ok) {
      set({ lastError: outcome.reason });
      return outcome.reason;
    }
    const c = outcome.core;
    set({
      lastError: null,
      clock: c.clock,
      reputation: c.reputation,
      owned: c.owned,
      completed: c.completed,
      offers: c.offers,
      active: c.active,
      lastReport: outcome.report ?? get().lastReport,
    });
    return null;
  };

  return {
    clock: initialClock(balance),
    reputation: 0,
    owned: {},
    completed: [],
    offers: [],
    nextOfferMinute: 0,
    offerSeq: 0,
    rng: newRng(),
    active: null,
    speed: 1,
    maps: {},
    lastReport: null,
    lastError: null,
    selectedUid: null,
    placing: null,
    wireCable: 'utp_cat5e',
    lastTrace: null,
    probe: (kind, src, dst, port) => {
      const active = get().active;
      if (!active) return;
      const net = { nodes: active.nodes, links: active.links };
      const result = kind === 'ping' ? pingProbe(net, gameEnv.engine, src, dst) : httpProbe(net, gameEnv.engine, src, dst, port);
      set({ lastTrace: { kind, src, dst, result } });
    },
    setSelected: (uid) => set({ selectedUid: uid }),
    setPlacing: (deviceId) => set({ placing: deviceId }),
    setWireCable: (cableId) => set({ wireCable: cableId }),
    tick: () =>
      set((s) => {
        const clock = advanceTick(s.clock, balance);
        let next: Partial<GameState> = { clock };
        const withClock = { ...s, ...next } as GameState;
        // 施工中なら、勤務時間内に作業を進める
        if (!clock.bankrupt && withClock.active?.phase === 'build') {
          const hour = toDate(clock.minute, balance).hour;
          const r = advanceBuild(coreOf(withClock), gameEnv, hour);
          if (r.ok) {
            next = {
              ...next,
              clock: r.core.clock,
              reputation: r.core.reputation,
              completed: r.core.completed,
              active: r.core.active,
              lastReport: r.report ?? s.lastReport,
            };
          }
        }
        const merged = { ...s, ...next } as GameState;
        return { ...next, ...refresh(merged) };
      }),
    setSpeed: (speed) => set({ speed }),
    cacheMap: (map) =>
      set((s) => {
        const maps = { ...s.maps, [map.id]: map };
        return { maps, ...refresh({ ...s, maps }) };
      }),
    buy: (deviceId) => {
      const s = get();
      const price = devices[deviceId as keyof typeof devices].price;
      const result = buyDevice(s.clock.money, s.owned, deviceId, price);
      if (!result.ok) return false;
      // 受注中の案件に対する購入は、案件の費用に含める
      const active = s.active ? { ...s.active, cost: s.active.cost + price } : null;
      set({ clock: { ...s.clock, money: result.money }, owned: result.owned, active });
      return true;
    },
    accept: (offerId) => apply(accept(coreOf(get()), offerId)),
    place: (deviceId, x, y) => {
      const s = get();
      const map = s.active ? s.maps[s.active.contract.map] : undefined;
      if (!map) return 'map';
      return apply(placeDevice(coreOf(s), deviceId, x, y, map, gameEnv));
    },
    connect: (aUid, bUid, cableId) => apply(connect(coreOf(get()), aUid, bUid, cableId, gameEnv)),
    removeNode: (uid) => apply(removeNode(coreOf(get()), uid)),
    setIface: (uid, port, ip) => apply(setInterface(coreOf(get()), uid, port, ip, 24)),
    setGateway: (uid, gateway) => apply(setGateway(coreOf(get()), uid, gateway)),
    addRoute: (uid, route) => apply(addRoute(coreOf(get()), uid, route)),
    removeRoute: (uid, index) => apply(removeRoute(coreOf(get()), uid, index)),
    requestBuild: () => apply(requestBuild(coreOf(get()), gameEnv)),
    abandon: () => apply(abandon(coreOf(get()))),
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
        active: save.active,
        lastReport: null,
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
        active: s.active,
      };
    },
  };
});
