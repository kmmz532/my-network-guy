// ゲーム全体の状態。時間・資金・評判・在庫・完了案件・依頼・受注中の案件・速度を持ち、Tick ごとに進める。
import { create } from 'zustand';
import { balance, contracts, contractTemplates, devices, furniture } from 'virtual:game-data';
import type { FurnitureId } from '../generated/ids';
import { advanceTick, initialClock, toDate, type ClockState } from '../sim/clock';
import { buyDevice } from '../sim/shop';
import { refreshOffers, type OfferEnv } from '../contracts/offers';
import type { Offer } from '../contracts/template';
import type { GameMap } from '../data/schema';
import type { Route } from '../network/types';
import type { SaveData } from '../services/migrations';
import { gameEnv } from '../sim/env';
import {
  hire as hireOp,
  initialOffice,
  placeFurniture as placeFurnitureOp,
  removeFurniture as removeFurnitureOp,
} from '../sim/furniture';
import {
  abandon,
  accept,
  advanceBuild,
  connect,
  placeDevice,
  removeNode,
  placeInOffice,
  removeFromOffice,
  requestBuild,
  setColor,
  setInterface,
  setGateway,
  addRoute,
  removeRoute,
  type Core,
  type Outcome,
  type Project,
  type Office,
  type Effects,
  noEffects,
  type Report,
  type Trace,
} from '../sim/project';

export type { Trace };
export type Tool = 'build' | 'paint';

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
  // 自社オフィスのネットワークと、自社案件で得た効果
  office: Office;
  effects: Effects;
  // 雇用中の社員の人数
  staff: number;
  speed: Speed;
  // 読み込み済みのマップ（保存しない）
  maps: Record<string, GameMap>;
  // 直近の検収結果（保存しない）
  lastReport: Report | null;
  dismissReport: () => void;
  // 画面に出す通知（給与の支払いなど）。保存しない
  notice: { key: string; params: Record<string, number>; id: number } | null;
  dismissNotice: () => void;
  // 直近に失敗した操作の理由（保存しない）
  lastError: string | null;
  // 操作の状態（保存しない）
  selectedUid: string | null;
  // 配置モードで置く機材（null なら配置しない）
  placing: string | null;
  // 配線に使うケーブル
  wireCable: string;
  // 直近の検収で流すパケット
  traces: Trace[];
  // 納品した直後の案件（結果を閉じるまでマップに表示する）
  showcase: Project | null;
  // 操作の種類と、色塗りで使う色
  tool: Tool;
  paintColor: number;
  setTool: (tool: Tool) => void;
  setPaintColor: (color: number) => void;
  // 社員の吹き出しに出すヒント（言語キー）
  hint: string | null;
  // 機器の名前とIPアドレスを表示するか、案件の内容を開いているか（保存しない）
  showIp: boolean;
  setShowIp: (on: boolean) => void;
  taskOpen: boolean;
  setTaskOpen: (open: boolean) => void;
  // 失敗した操作の理由を、失敗した地点（マップのタイル）に出す
  flash: { key: string; tx: number; ty: number; at: number } | null;
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
  // 自社オフィスの家具と社員。失敗したら理由を返す
  placeFurniture: (id: string, x: number, y: number) => string | null;
  removeFurniture: (uid: string) => string | null;
  hire: () => string | null;
  connect: (aUid: string, bUid: string, cableId: string) => string | null;
  removeNode: (uid: string) => string | null;
  paint: (uid: string, port: number) => string | null;
  // 機器の設定（設計中のみ）。失敗したら理由を返す
  setIface: (uid: string, port: number, ip: string) => string | null;
  setGateway: (uid: string, gateway: string | null) => string | null;
  addRoute: (uid: string, route: Route) => string | null;
  removeRoute: (uid: string, index: number) => string | null;
  requestBuild: () => string | null;
  abandon: () => string | null;
  load: (save: SaveData) => void;
  snapshot: () => SaveData;
  // 最初から始める（資金・在庫・依頼などを初期状態に戻す）
  newGame: () => void;
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
  office: s.office,
  effects: s.effects,
  staff: s.staff,
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

// 検収の結果を画面の状態に反映する（パケット・納品後の表示・ヒント）
const reportState = (report: Report | undefined, s: GameState): Partial<GameState> => {
  if (!report) return {};
  return {
    lastReport: report,
    traces: report.traces,
    showcase: report.passed ? s.active : null,
    hint: report.passed ? null : (report.hint ?? null),
  };
};

export const useGameStore = create<GameState>((set, get) => {
  // 案件の操作の結果を状態に反映する。失敗なら理由を返す
  // 機器の位置（失敗の吹き出しを出す場所）
  const tileOf = (uid: string) => {
    const n = get().active?.nodes.find((x) => x.uid === uid) ?? get().office.nodes.find((x) => x.uid === uid);
    return n ? { tx: n.x, ty: n.y } : undefined;
  };

  const apply = (outcome: Outcome, at?: { tx: number; ty: number }): string | null => {
    if (!outcome.ok) {
      const flash = at ? { key: `ui.error.${outcome.reason}`, ...at, at: Date.now() } : null;
      set({ lastError: outcome.reason, ...(flash ? { flash } : {}) });
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
      office: c.office,
      effects: c.effects,
      staff: c.staff,
      ...reportState(outcome.report, get()),
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
    office: initialOffice(balance),
    effects: noEffects(),
    staff: balance.staff.initialCount,
    speed: 1,
    maps: {},
    lastReport: null,
    notice: null,
    dismissReport: () => set({ lastReport: null, showcase: null, traces: [] }),
    dismissNotice: () => set({ notice: null }),
    lastError: null,
    selectedUid: null,
    placing: null,
    wireCable: 'utp_cat5e',
    traces: [],
    showcase: null,
    tool: 'build',
    paintColor: 1,
    setTool: (tool) => set({ tool, placing: null }),
    setPaintColor: (color) => set({ paintColor: color, tool: 'paint', placing: null }),
    hint: null,
    showIp: true,
    setShowIp: (on) => set({ showIp: on }),
    taskOpen: true,
    setTaskOpen: (open) => set({ taskOpen: open }),
    flash: null,
    setSelected: (uid) => set({ selectedUid: uid }),
    setPlacing: (deviceId) => set({ placing: deviceId }),
    setWireCable: (cableId) => set({ wireCable: cableId }),
    tick: () =>
      set((s) => {
        const clock = advanceTick(s.clock, balance, s.staff);
        let next: Partial<GameState> = { clock };
        // 月末に給与を払ったら知らせる
        if (clock.paidMonths > s.clock.paidMonths) {
          const amount = s.staff * balance.staff.monthlySalary;
          next = { ...next, notice: { key: 'ui.notice.salary', params: { amount }, id: Date.now() } };
        }
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
              office: r.core.office,
              effects: r.core.effects,
              ...reportState(r.report, withClock),
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
      const isFurniture = deviceId in furniture;
      const price = isFurniture
        ? furniture[deviceId as FurnitureId].price
        : devices[deviceId as keyof typeof devices].price;
      const result = buyDevice(s.clock.money, s.owned, deviceId, price);
      if (!result.ok) return false;
      // 受注中の案件に対する機材の購入は、案件の費用に含める（家具は自社オフィスのものなので含めない）
      const active = isFurniture ? s.active : s.active ? { ...s.active, cost: s.active.cost + price } : null;
      set({ clock: { ...s.clock, money: result.money }, owned: result.owned, active });
      return true;
    },
    accept: (offerId) => apply(accept(coreOf(get()), offerId)),
    // 在庫の機材・家具を配置する（購入はショップで行う）。案件がなければ自社オフィスに置く
    place: (deviceId, x, y) => {
      if (deviceId in furniture) return get().placeFurniture(deviceId, x, y);
      if (!get().active) {
        const hq = get().maps.hq;
        if (!hq) return 'map';
        return apply(placeInOffice(coreOf(get()), deviceId, x, y, hq, gameEnv), { tx: x, ty: y });
      }
      const map = get().maps[get().active!.contract.map];
      if (!map) return 'map';
      return apply(placeDevice(coreOf(get()), deviceId, x, y, map, gameEnv), { tx: x, ty: y });
    },
    placeFurniture: (id, x, y) => {
      const hq = get().maps.hq;
      if (!hq) return 'map';
      return apply(placeFurnitureOp(coreOf(get()), id, x, y, hq), { tx: x, ty: y });
    },
    removeFurniture: (uid) => {
      const f = get().office.furniture.find((x) => x.uid === uid);
      return apply(removeFurnitureOp(coreOf(get()), uid), f ? { tx: f.x, ty: f.y } : undefined);
    },
    hire: () => apply(hireOp(coreOf(get()), (id) => furniture[id as FurnitureId]?.seat === true)),
    connect: (aUid, bUid, cableId) =>
      apply(connect(coreOf(get()), aUid, bUid, cableId, gameEnv), tileOf(bUid)),
    removeNode: (uid) => {
      if (!get().active) {
        const n = get().office.nodes.find((x) => x.uid === uid);
        return apply(removeFromOffice(coreOf(get()), uid), n ? { tx: n.x, ty: n.y } : undefined);
      }
      return apply(removeNode(coreOf(get()), uid), tileOf(uid));
    },
    paint: (uid, port) => apply(setColor(coreOf(get()), uid, port, get().paintColor), tileOf(uid)),
    setIface: (uid, port, ip) => apply(setInterface(coreOf(get()), uid, port, ip, 24), tileOf(uid)),
    setGateway: (uid, gateway) => apply(setGateway(coreOf(get()), uid, gateway), tileOf(uid)),
    addRoute: (uid, route) => apply(addRoute(coreOf(get()), uid, route), tileOf(uid)),
    removeRoute: (uid, index) => apply(removeRoute(coreOf(get()), uid, index), tileOf(uid)),
    requestBuild: () => {
      set({ hint: null, traces: [] });
      return apply(requestBuild(coreOf(get()), gameEnv));
    },
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
        office: save.office,
        effects: save.effects,
        staff: save.staff,
        lastReport: null,
        showcase: null,
        traces: [],
        hint: null,
      }),
    newGame: () =>
      set((s) => {
        const base: Partial<GameState> = {
          clock: initialClock(balance),
          reputation: 0,
          owned: {},
          completed: [],
          offers: [],
          nextOfferMinute: 0,
          offerSeq: 0,
          rng: newRng(),
          active: null,
          office: initialOffice(balance),
          effects: noEffects(),
          staff: balance.staff.initialCount,
          lastReport: null,
          lastError: null,
          traces: [],
          showcase: null,
          hint: null,
          selectedUid: null,
          placing: null,
          speed: 1,
        };
        // 新しく始めたら、最初の依頼をすぐ届ける
        return { ...base, ...refresh({ ...s, ...base } as GameState) };
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
        office: s.office,
        effects: s.effects,
        staff: s.staff,
      };
    },
  };
});
