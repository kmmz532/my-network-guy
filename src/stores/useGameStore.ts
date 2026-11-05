// ゲーム全体の状態。時間・資金・評判・在庫・完了案件・依頼・受注中の案件・速度を持ち、Tick ごとに進める。
import { create } from 'zustand';
import { balance, contracts, contractTemplates, devices, furniture } from 'virtual:game-data';
import type { FurnitureId } from '../generated/ids';
import { advanceTick, initialClock, toDate, type ClockState } from '../sim/clock';
import { buyDevice } from '../sim/shop';
import { refreshOffers, type OfferEnv } from '../contracts/offers';
import type { Offer } from '../contracts/template';
import type { GameMap, Staff } from '../data/schema';
import { hintTier, initialStaff, rollCandidates, totalSalary } from '../sim/staff';
import { hasKey } from '../i18n/t';
import { rand } from '../sim/rng';
import { finishTrainings, startTraining as startTrainingOp, takeExam as takeExamOp, type TrainingEnv } from '../sim/training';
import { certs as certRecord, training as trainingRecord } from 'virtual:game-data';
import type { NetLink, NetNode, Route } from '../network/types';
import type { SaveData } from '../services/migrations';
import { gameEnv } from '../sim/env';
import {
  hire as hireOp,
  initialOffice,
  placeFurniture as placeFurnitureOp,
  removeFurniture as removeFurnitureOp,
} from '../sim/furniture';
import {
  type PortChoice,
  abandon,
  accept,
  advanceBuild,
  connect,
  placeDevice,
  removeNode,
  placeInOffice,
  removeFromOffice,
  requestBuild,
  setInterface,
  setGateway,
  setSegment,
  setService,
  replug,
  addRoute,
  removeRoute,
  removeLink,
  type End,
  type NetTarget,
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
// 道具: 選択（機器の画面を開く）・配線・撤去
export type Tool = 'select' | 'wire' | 'remove';

// 配線の起点（ポートを選んだ機器）。null は「おまかせ」
export interface WireStart {
  uid: string;
  port: number | null;
}

// ポートの一覧の吹き出し。画面上の位置（ビューポートの座標）。role は起点を選ぶ（from）か、相手を選ぶ（to）
export interface PortMenuState {
  uid: string;
  x: number;
  y: number;
  role: 'from' | 'to';
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
  // 受注中の案件（複数）
  active: Project[];
  // いま設計・表示している案件のID
  focus: string | null;
  // 自社オフィスのネットワークと、自社案件で得た効果
  office: Office;
  effects: Effects;
  // 雇用中の社員と、社員の uid の連番
  staff: Staff[];
  staffSeq: number;
  // 採用の候補
  candidates: Staff[];
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
  // 操作の種類
  tool: Tool;
  setTool: (tool: Tool) => void;
  // 配線の途中の起点（ポートを選んだ機器）と、ポートの一覧の吹き出し（保存しない）
  wireStart: WireStart | null;
  portMenu: PortMenuState | null;
  // 配線の道具で機器を押したとき、ポートの一覧を開く（起点を選ぶか、相手を選ぶかは起点の有無で決まる）
  openPortMenu: (uid: string, x: number, y: number) => void;
  // ポートの一覧で選んだポート（null は「おまかせ」）。起点なら起点にし、相手なら配線する
  pickPort: (port: number | null) => void;
  // 配線の途中（起点と一覧）を取り消す
  cancelWire: () => void;
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
  accept: (offerId: string, crew: string[]) => string | null;
  place: (deviceId: string, x: number, y: number) => string | null;
  // 自社オフィスの家具と社員。失敗したら理由を返す
  placeFurniture: (id: string, x: number, y: number) => string | null;
  removeFurniture: (uid: string) => string | null;
  hire: (candidateUid: string) => string | null;
  startTraining: (uid: string, courseId: string) => string | null;
  takeExam: (uid: string, certId: string) => string | null;
  connect: (aUid: string, bUid: string, cableId: string, ports?: PortChoice) => string | null;
  removeLink: (uid: string) => string | null;
  removeNode: (uid: string) => string | null;
  // 機器の設定（設計中のみ）。失敗したら理由を返す
  setIface: (uid: string, port: number, ip: string) => string | null;
  setGateway: (uid: string, gateway: string | null) => string | null;
  // セグメント（ポートが属するネットワーク）のアドレスを設定する
  setSegment: (uid: string, port: number, network: string, prefix: number) => string | null;
  // 配線の片方の端を、同じ機器の別のポートへ挿し替える
  replug: (linkUid: string, end: End, port: number) => string | null;
  // サービスを起動（on）・停止する
  setService: (uid: string, protocol: 'http', on: boolean) => string | null;
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

// 研修と資格の定義（ゲームデータ）
const trainingEnv: TrainingEnv = { courses: trainingRecord, certs: certRecord, balance };

// 配線・設定の対象。設計・表示している案件があればその案件、なければ自社オフィス
export const netTargetOf = (s: { active: Project[]; focus: string | null }): NetTarget =>
  focusedProject(s) ? 'focus' : 'office';

// いま設計・表示している案件（なければ null）
export const focusedProject = (s: { active: Project[]; focus: string | null }): Project | null =>
  s.focus === null ? null : (s.active.find((p) => p.id === s.focus) ?? null);

// 機器を編集できる対象の機器と配線（自社オフィス、または設計中の案件）。編集できなければ null
export const editNetOf = (s: GameState): { nodes: NetNode[]; links: NetLink[] } | null => {
  if (s.active.length === 0 && !s.showcase) return { nodes: s.office.nodes, links: s.office.links };
  const p = focusedProject(s);
  return p?.phase === 'design' ? { nodes: p.nodes, links: p.links } : null;
};

// 新しいゲームの乱数と初期の社員
const newStart = () => {
  const init = initialStaff(balance, newRng());
  return { rng: init.rng, staff: init.staff, staffSeq: init.staffSeq };
};

export const coreOf = (s: GameState): Core => ({
  clock: s.clock,
  reputation: s.reputation,
  owned: s.owned,
  completed: s.completed,
  offers: s.offers,
  active: s.active,
  office: s.office,
  effects: s.effects,
  staff: s.staff,
  staffSeq: s.staffSeq,
  candidates: s.candidates,
  focus: s.focus,
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
      excluded: s.active.map((p) => p.baseId),
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
    showcase: report.passed ? (report.delivered ?? null) : null,
    hint: report.passed ? null : hintKeyOf(report, s),
  };
};

// 疎通テストに失敗したときのヒント。担当の level の段階で、段階1は「どこかおかしい」、段階2は失敗の分類、段階3は案件のヒント
const hintKeyOf = (report: Report, s: GameState): string | null => {
  const project = focusedProject(s);
  const crew = s.staff.filter((m) => project?.crew.includes(m.uid) ?? false);
  const tier = hintTier(crew, undefined, balance.staff.hintLevels);
  const reason = report.failures[0]?.reason;
  if (tier === 1) return 'ui.hint.tier1';
  if (tier === 2 && reason && hasKey(`error.${reason}`)) return `error.${reason}`;
  return report.hint ?? null;
};

export const useGameStore = create<GameState>((set, get) => {
  // 案件の操作の結果を状態に反映する。失敗なら理由を返す
  // 機器の位置（失敗の吹き出しを出す場所）
  const tileOf = (uid: string) => {
    const n = focusedProject(get())?.nodes.find((x) => x.uid === uid) ?? get().office.nodes.find((x) => x.uid === uid);
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
      focus: c.focus,
      office: c.office,
      effects: c.effects,
      staff: c.staff,
      staffSeq: c.staffSeq,
      candidates: c.candidates,
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
    ...newStart(),
    candidates: [],
    active: [],
    focus: null,
    office: initialOffice(balance),
    effects: noEffects(),
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
    tool: 'select',
    // 道具を変えると、配線の途中・一覧・置く予定の機材を取り消す。選択の道具以外では機器の画面を閉じる
    setTool: (tool) => {
      const s = get();
      if (s.tool === tool && !s.placing) return;
      set({
        tool,
        placing: null,
        wireStart: null,
        portMenu: null,
        ...(tool === 'select' ? {} : { selectedUid: null }),
      });
    },
    wireStart: null,
    portMenu: null,
    openPortMenu: (uid, x, y) =>
      set((s) => ({
        portMenu: { uid, x, y, role: s.wireStart && s.wireStart.uid !== uid ? 'to' : 'from' },
      })),
    pickPort: (port) => {
      const s = get();
      const menu = s.portMenu;
      if (!menu) return;
      if (menu.role === 'from') {
        set({ wireStart: { uid: menu.uid, port }, portMenu: null });
        return;
      }
      const start = s.wireStart;
      if (!start) {
        set({ portMenu: null });
        return;
      }
      // 配線できたら途中を終える。できなければ起点を残し、理由を出す
      const reason = get().connect(start.uid, menu.uid, s.wireCable, {
        a: start.port ?? undefined,
        b: port ?? undefined,
      });
      set({ portMenu: null, wireStart: reason === null ? null : start });
    },
    cancelWire: () => set({ wireStart: null, portMenu: null }),
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
        const clock = advanceTick(s.clock, balance, totalSalary(s.staff));
        let next: Partial<GameState> = { clock };
        // 月末に給与を払ったら知らせる
        if (clock.paidMonths > s.clock.paidMonths) {
          const amount = totalSalary(s.staff);
          // 毎月1日に、採用の候補を作り直す
          const rolled = rollCandidates(s.reputation, clock.paidMonths, s.rng, balance);
          next = {
            ...next,
            notice: { key: 'ui.notice.salary', params: { amount }, id: Date.now() },
            candidates: rolled.candidates,
            rng: rolled.rng,
          };
        }
        // 研修の期日が来た社員は、経験値を得て研修を終える
        const trainedStaff = finishTrainings(coreOf({ ...s, ...next } as GameState), trainingEnv).staff;
        if (trainedStaff !== s.staff) next = { ...next, staff: trainedStaff };
        const withClock = { ...s, ...next } as GameState;
        // 施工中なら、勤務時間内に作業を進める
        if (!clock.bankrupt && withClock.active.some((p) => p.phase === 'build')) {
          const hour = toDate(clock.minute, balance).hour;
          const r = advanceBuild(coreOf(withClock), gameEnv, hour);
          if (r.ok) {
            next = {
              ...next,
              clock: r.core.clock,
              reputation: r.core.reputation,
              completed: r.core.completed,
              active: r.core.active,
              focus: r.core.focus,
              staff: r.core.staff,
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
      const focused = focusedProject(s);
      const active =
        !isFurniture && focused
          ? s.active.map((p) => (p.id === focused.id ? { ...p, cost: p.cost + price } : p))
          : s.active;
      set({ clock: { ...s.clock, money: result.money }, owned: result.owned, active });
      return true;
    },
    accept: (offerId, crew) => apply(accept(coreOf(get()), offerId, balance.office.projectSlots, crew)),
    // 在庫の機材・家具を配置する（購入はショップで行う）。案件がなければ自社オフィスに置く
    place: (deviceId, x, y) => {
      if (deviceId in furniture) return get().placeFurniture(deviceId, x, y);
      if (get().active.length === 0) {
        const hq = get().maps.hq;
        if (!hq) return 'map';
        return apply(placeInOffice(coreOf(get()), deviceId, x, y, hq, gameEnv), { tx: x, ty: y });
      }
      const map = get().maps[focusedProject(get())!.contract.map];
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
    hire: (candidateUid) => apply(hireOp(coreOf(get()), candidateUid, (id) => furniture[id as FurnitureId]?.seat === true)),
    connect: (aUid, bUid, cableId, ports = {}) =>
      apply(connect(coreOf(get()), aUid, bUid, cableId, gameEnv, netTargetOf(get()), ports), tileOf(bUid)),
    removeLink: (uid) => apply(removeLink(coreOf(get()), uid, netTargetOf(get()), gameEnv)),
    startTraining: (uid, courseId) => apply(startTrainingOp(coreOf(get()), uid, courseId, trainingEnv)),
    takeExam: (uid, certId) => {
      // 合否は乱数で決める。乱数は受験のときだけ進める
      const s = get();
      const roll = rand(s.rng);
      const reason = apply(takeExamOp(coreOf(s), uid, certId, roll.value, trainingEnv));
      if (reason === null) set({ rng: roll.state });
      return reason;
    },
    removeNode: (uid) => {
      if (get().active.length === 0) {
        const n = get().office.nodes.find((x) => x.uid === uid);
        return apply(removeFromOffice(coreOf(get()), uid, gameEnv), n ? { tx: n.x, ty: n.y } : undefined);
      }
      return apply(removeNode(coreOf(get()), uid, gameEnv), tileOf(uid));
    },
    setIface: (uid, port, ip) =>
      apply(setInterface(coreOf(get()), uid, port, ip, 24, gameEnv, netTargetOf(get())), tileOf(uid)),
    setGateway: (uid, gateway) => apply(setGateway(coreOf(get()), uid, gateway, netTargetOf(get())), tileOf(uid)),
    setSegment: (uid, port, network, prefix) =>
      apply(setSegment(coreOf(get()), uid, port, network, prefix, gameEnv, netTargetOf(get())), tileOf(uid)),
    replug: (linkUid, end, port) => apply(replug(coreOf(get()), linkUid, end, port, gameEnv, netTargetOf(get()))),
    setService: (uid, protocol, on) => apply(setService(coreOf(get()), uid, protocol, on, netTargetOf(get())), tileOf(uid)),
    addRoute: (uid, route) => apply(addRoute(coreOf(get()), uid, route, netTargetOf(get())), tileOf(uid)),
    removeRoute: (uid, index) => apply(removeRoute(coreOf(get()), uid, index, netTargetOf(get())), tileOf(uid)),
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
        focus: save.focus,
        office: save.office,
        effects: save.effects,
        staff: save.staff,
        staffSeq: save.staffSeq,
        candidates: save.candidates,
        lastReport: null,
        showcase: null,
        traces: [],
        hint: null,
        wireStart: null,
        portMenu: null,
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
          ...newStart(),
          candidates: [],
          active: [],
          focus: null,
          office: initialOffice(balance),
          effects: noEffects(),
          lastReport: null,
          lastError: null,
          traces: [],
          showcase: null,
          hint: null,
          selectedUid: null,
          placing: null,
          wireStart: null,
          portMenu: null,
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
        focus: s.focus,
        office: s.office,
        effects: s.effects,
        staff: s.staff,
        staffSeq: s.staffSeq,
        candidates: s.candidates,
      };
    },
  };
});
