// ゲーム全体の状態。時間・資金・評判・在庫・完了案件・依頼・受注中の案件・速度を持ち、Tick ごとに進める。
import { loadSettings, saveSettings } from '../settings/settings';
import { playConnect, playDeliver, playFail } from '../audio/sfx';
import { create } from 'zustand';
import { balance, cables, contracts, contractTemplates, devices, furniture, guides, levelMilestones } from 'virtual:game-data';
import type { FurnitureId } from '../generated/ids';
import { advanceTick, initialClock, minutesPerDay, minutesPerMonth, toDate, type ClockState } from '../sim/clock';
import { isOnShift } from '../sim/shift';
import { nightSpeedStep } from '../sim/nightSpeed';
import { buyDevice, sellDevice } from '../sim/shop';
import { declineOffer, offerHint, refreshOffers, type OfferEnv, type OfferHint } from '../contracts/offers';
import type { Offer } from '../contracts/template';
import type { GameMap, Staff } from '../data/schema';
import { initialStaff, rollCandidates, staffCapOf, totalSalary } from '../sim/staff';
import { expAtLevel, levelOf, levelUpsBetween, type UnlockItem } from '../sim/level';
import { grantDailyExp, type ExpSource } from '../sim/companyExp';
import { rand } from '../sim/rng';
import { finishTrainings, startTraining as startTrainingOp, takeExam as takeExamOp, type TrainingEnv } from '../sim/training';
import { certs as certRecord, training as trainingRecord } from 'virtual:game-data';
import type { FirewallRule, NetLink, NetNode, Route } from '../network/types';
import type { GameMode, SaveData } from '../services/migrations';
import { resizeSandboxOffice, sandboxClock, sandboxOffice, sandboxTest } from '../sim/sandbox';
import { gameEnv } from '../sim/env';
import { learnFromPing } from '../network/learn';
import { rentalOf } from '../network/external';
import { applyMoney } from '../sim/ledger';
import { EMPTY_FAMILIARITY, type Familiarity } from '../sim/familiar';
import type { MacEntry } from '../network/mac';
import { autoAssign } from '../sim/autoAssign';
import { type ExpandSide, expandOffice as expandOfficeOp, mapOfOffice } from '../sim/office';
import {
  type DesignEntry,
  type History,
  OFFICE_HISTORY_KEY,
  emptyHistory,
  entryOf,
  historyKeyOf,
  projectHistoryKey,
  push as pushHistory,
  redo as redoHistory,
  stepDesign,
  undo as undoHistory,
} from '../sim/history';
import { type WindowItem, type WindowKind, type WindowMemory, closeRef, closeWindow as closeWindowOp, focusWindow as focusWindowOp, frontWindow, moveWindow as moveWindowOp, openWindow as openWindowOp, toggleWindow as toggleWindowOp, closeTab as closeTabOp, fitWindows as fitWindowsOp, selectTab as selectTabOp, reorderTab as reorderTabOp, parseMemory, remember, resizeWindow as resizeWindowOp, placeWindow as placeWindowOp, type Rect, type Viewport } from '../ui/windows';
import { isPhoneNow } from '../ui/usePhone';
import {
  hire as hireOp,
  initialOffice,
  placeFurniture as placeFurnitureOp,
  moveFurniture as moveFurnitureOp,
  removeFurniture as removeFurnitureOp,
} from '../sim/furniture';
import {
  type PortChoice,
  abandon,
  accept,
  acceptDelegated as acceptDelegatedOp,
  applyBlueprint as applyBlueprintOp,
  advanceBuild,
  connect,
  placeDevice,
  removeNode,
  placeInOffice,
  removeFromOffice,
  requestBuild,
  setInterface,
  setGateway,
  setFirewallRules,
  setSegment,
  setService,
  setName as setNameOp,
  setHostname as setHostnameOp,
  setNameServer as setNameServerOp,
  setDnsRole as setDnsRoleOp,
  autoRegisterZone as autoRegisterZoneOp,
  setHost as setHostOp,
  removeHost as removeHostOp,
  replug,
  moveNode,
  replugTo,
  addRoute,
  removeRoute,
  removeLink,
  type End,
  type NetTarget,
  type Core,
  type Outcome,
  type Project,
  type Office,
  type OfficeSize,
  type Effects,
  noEffects,
  type GoalCheck,
  type Report,
  type Trace,
  testDesign,
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

// インベントリの欄からドラッグ中の品目と、画面の位置（クライアントの座標）。保存しない
export interface ItemDrag {
  id: string;
  x: number;
  y: number;
}

export type Speed = 0 | 1 | 2 | 4;

// 覚えた位置と大きさを保存する場所（端末ごと。セーブデータには入れない）
const MEMORY_KEY = 'network-ya.windows.v1';
const readMemory = (): WindowMemory => {
  try {
    return parseMemory(window.localStorage.getItem(MEMORY_KEY));
  } catch {
    return {};
  }
};
const writeMemory = (memory: WindowMemory): void => {
  try {
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // 保存できなくても、画面の操作は続けられる
  }
};

export const viewportNow = (): Viewport => ({ w: window.innerWidth, h: window.innerHeight, phone: isPhoneNow() });

export interface PlannedNet {
  network: string;
  prefix: number;
}
export const plannedKey = (uid: string, port: number): string => `${uid}:${port}`;

export interface GameState {
  // 詳しくで選んだネットワーク（画面の状態。セーブには入らない）。キーは plannedKey
  planned: Record<string, PlannedNet>;
  // 遊び方（career は案件の経営ゲーム、sandbox は自由に設計する練習場）。セーブデータに入る
  mode: GameMode;
  clock: ClockState;
  companyExp: number;
  // 評判（★の数の積み上げ。解放の条件には使わない。N55）
  reputation: number;
  // 今日（ゲームの日）に経験値を得た量。1日の上限（balance.exp.dailyCap）に使う（N55）
  expDay: number;
  expToday: number;
  // デバッグ（N54）: 案内を開始する手順（一度だけ使う。保存しない）
  debugGuide: { id: string; step: number } | null;
  owned: Record<string, number>;
  completed: string[];
  // 納品した案件の数（N66）
  deliveries: number;
  // なじみの依頼の回数と型紙（N70）
  familiarity: Familiarity;
  // 通信で覚えた ARP の表と、スイッチの MAC の表（画面の状態。保存しない。N69）。キーは「案件の ID または office」と機器の uid
  arpTable: Record<string, { ip: string; mac: string }[]>;
  macTable: Record<string, MacEntry[]>;
  offers: Offer[];
  nextOfferMinute: number;
  offerSeq: number;
  // 新しく解放した種類の届いた件数（N51b）
  newArrivals: Record<string, number>;
  // まとめて届いた件数（一覧を開くまで残る。0 なら知らせない）
  offerBurst: number;
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
  // 初めての概念の案内を終えた（または飛ばした）固定案件のID（セーブデータに入る）
  guidesDone: string[];
  // 案内が光らせている機器の uid（マップの描画は別の担当。保存しない）
  guideTarget: string | null;
  setGuideTarget: (uid: string | null) => void;
  // デバッグ（N54）: お金・経験値・レベル・在庫・時刻を、既存の仕組みで変える
  debugAddMoney: (amount: number) => void;
  debugSetCompanyLevel: (level: number) => void;
  debugAddOwned: (device: string, count: number) => void;
  debugSetMinute: (minute: number) => void;
  // 案内を終えた案件として記録する
  markGuideDone: (contractId: string) => void;
  // 納品以外の経験値（案内・採用・拡張・家具。1日の上限あり。N55）
  grantCompanyExp: (source: ExpSource) => void;
  // デバッグ（N54）: 案内の進みを最初に戻す
  debugResetGuides: () => void;
  // デバッグ（N54）: 依頼を今すぐ引き直す（届く時刻を今に合わせ、判定を1回行う）
  debugRefreshOffers: () => void;
  // デバッグ（N54）: 施工中の案件を、時間を進めて最後まで進める（検収の結果が出るまで）
  debugFinishBuild: () => void;
  // デバッグ（N54）: 案内を指定の手順から出す（案件を受注して設計に入る）。受注できないときは理由を返し、何も変えない
  debugStartGuide: (contractId: string, step: number) => string | null;
  // デバッグ（N54）: 案内を終わった扱いにする（経験値は増やさない）
  debugMarkGuideDone: (contractId: string) => void;
  // 案内の開始の指定を、Guide が受け取ったあとに消す
  debugConsumeGuide: () => void;
  speed: Speed;
  // 勤務時間外の早送りで、自動で変える前の速さ（自動で変えていなければ null。保存しない）
  nightSpeed: Speed | null;
  // 時間が止まっているときの施工の確認を開いているか（保存しない）
  pausedPrompt: boolean;
  // 確認の答え。mode は 1倍で進める（play）か止めたまま（stay）。remember なら設定に残す
  answerPausedBuild: (mode: 'play' | 'stay', remember: boolean) => void;
  // 読み込み済みのマップ（保存しない）
  maps: Record<string, GameMap>;
  // 直近の検収結果（保存しない）
  lastReport: Report | null;
  dismissReport: () => void;
  // 画面に出す通知（給与の支払いなど）。保存しない
  notice: { key: string; params: Record<string, number>; id: number } | null;
  dismissNotice: () => void;
  // 設計の取り消しの履歴（案件ごと・自社オフィスごと）。保存しない
  histories: Record<string, History<DesignEntry>>;
  // 設計の操作を1つ元に戻す・やり直す（戻せなければ何もしない）
  undo: () => void;
  redo: () => void;
  // 資金か在庫が足りず、元に戻せなかった・やり直せなかったとき、その種類（保存しない）
  historyError: 'undo' | 'redo' | null;
  // 直近に失敗した操作の理由（保存しない）
  lastError: string | null;
  // 開いているウィンドウ（機器の画面・社員の札）。保存しない。手前ほど z が大きい
  windows: WindowItem[];
  windowSeq: number;
  // 種類ごとに最後に置いた位置と大きさ（localStorage に保存する）
  windowMemory: WindowMemory;
  openWindow: (kind: WindowKind, ref: string) => void;
  toggleWindow: (kind: WindowKind, ref: string) => void;
  closeWindow: (id: number) => void;
  closeTab: (id: number, ref: string) => void;
  // 画面の大きさが変わったとき、開いているウィンドウを画面の中に収める（覚える位置は変えない）
  fitWindows: () => void;
  selectTab: (id: number, ref: string) => void;
  // ウィンドウのタブを並べ替える（from から to の位置へ）
  reorderTab: (id: number, from: number, to: number) => void;
  focusWindow: (id: number) => void;
  moveWindow: (id: number, x: number, y: number) => void;
  resizeWindow: (id: number, w: number, h: number) => void;
  // 位置と大きさを、辺のドラッグの結果のまま置く（N57）
  placeWindow: (id: number, rect: Rect) => void;
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
  // 最後のテストまたは検収の判定（案件ごと）。設計を変えると消える（保存しない）
  check: { projectId: string; goals: GoalCheck[] } | null;
  // 失敗の直し方を開いている機器（保存しない）
  helpUid: string | null;
  setHelpUid: (uid: string | null) => void;
  // 施工を断られた回数。テストのボタンを1秒光らせるために使う（保存しない）
  testNudge: number;
  // テストを押す。失敗したら理由を返す
  test: () => string | null;
  // 機器の名前とIPアドレスを表示するか、案件の内容を開いているか（保存しない）
  showIp: boolean;
  setShowIp: (on: boolean) => void;
  taskOpen: boolean;
  setTaskOpen: (open: boolean) => void;
  // 失敗した操作の理由を、失敗した地点（マップのタイル）に出す
  flash: { key: string; tx: number; ty: number; at: number } | null;
  // 直近につないだ2つの機器と時刻。つながった瞬間に、ケーブルの上を光が走らせる（画面だけの表示）
  linkPulse: { a: string; b: string; at: number } | null;
  // 給与を払えない月に、払う前に時間を止めた月（paidMonths の値）。同じ月は、もう止めない（保存しない）
  payWarned: number | null;
  setPlacing: (deviceId: string | null) => void;
  // インベントリの欄から品目をドラッグしている間の位置（保存しない）
  itemDrag: ItemDrag | null;
  setItemDrag: (drag: ItemDrag | null) => void;
  setWireCable: (cableId: string) => void;
  tick: () => void;
  setSpeed: (speed: Speed) => void;
  cacheMap: (map: GameMap) => void;
  // 購入に成功したら true
  buy: (deviceId: string) => boolean;
  // 在庫を1台売ったら true（サンドボックスでは売らない）
  sell: (deviceId: string) => boolean;
  // 案件の流れの操作。失敗したら理由を返す（成功なら null）
  accept: (offerId: string, crew: string[]) => string | null;
  // 設計中の案件に型紙を写す（N70）
  useBlueprint: () => string | null;
  // 社員に任せて受注する（N70）。任せられない理由は delegationReason で分かる
  acceptDelegated: (offerId: string, crew: string[]) => string | null;
  place: (deviceId: string, x: number, y: number) => string | null;
  // 自社オフィスの家具と社員。失敗したら理由を返す
  placeFurniture: (id: string, x: number, y: number) => string | null;
  // 自社オフィスの部屋の辺を買って2マス広げる（確認なし。取り消しの対象外）。失敗したら理由を返す
  expandOffice: (side: ExpandSide) => string | null;
  removeFurniture: (uid: string) => string | null;
  hire: (candidateUid: string, shift: 'day' | 'night') => string | null;
  startTraining: (uid: string, courseId: string) => string | null;
  takeExam: (uid: string, certId: string) => string | null;
  connect: (aUid: string, bUid: string, cableId: string, ports?: PortChoice) => string | null;
  removeLink: (uid: string) => string | null;
  removeNode: (uid: string) => string | null;
  // 機器の設定（設計中のみ）。失敗したら理由を返す
  setIface: (uid: string, port: number, ip: string, prefix?: number) => string | null;
  setGateway: (uid: string, gateway: string | null) => string | null;
  // ファイアウォールの規則を置き換える（N38）
  setFirewallRules: (uid: string, rules: FirewallRule[]) => string | null;
  // セグメント（ポートが属するネットワーク）のアドレスを設定する
  setSegment: (uid: string, port: number, network: string, prefix: number) => string | null;
  // 詳しくで選んだ、まだ設定のないポートのネットワーク（null で消す）。配線・セグメントの設定のときに使う
  setPlanned: (uid: string, port: number, net: PlannedNet | null) => void;
  // まとめて届いた知らせを消す（依頼の一覧を開いたとき）
  clearOfferBurst: () => void;
  // 定型案件の依頼を断る（固定案件は断れない）
  declineOffer: (id: string) => void;
  // 配線の片方の端を、同じ機器の別のポートへ挿し替える
  replug: (linkUid: string, end: End, port: number) => string | null;
  // 機器・家具を別のマスへ動かす（配置と同じ判定。ケーブルは付いたまま、費用の差額を払う）。失敗したら理由を返す
  moveNode: (uid: string, x: number, y: number) => string | null;
  moveFurniture: (uid: string, x: number, y: number) => string | null;
  // ケーブルの端を、別の機器の空いているポートへ挿す（port が null なら空いている最小の番号）
  replugTo: (linkUid: string, end: End, nodeUid: string, port: number | null) => string | null;
  // サービスを起動（on）・停止する
  setService: (uid: string, protocol: 'http', on: boolean) => string | null;
  setName: (uid: string, name: string) => string | null;
  // ホスト名を付ける（null で外す）（N46）
  setHostname: (uid: string, hostname: string | null) => string | null;
  setNameServer: (uid: string, ip: string | null) => string | null;
  setDnsRole: (uid: string, on: boolean) => string | null;
  // ping が通ったときに、ARP と MAC の表へ覚える（N69）
  learnPing: (srcUid: string, dstUid: string) => void;
  autoRegisterZone: (uid: string) => string | null;
  // 対応表（名前と IPアドレス）の登録と削除。失敗したら理由を返す
  setHost: (uid: string, name: string, ip: string) => string | null;
  removeHost: (uid: string, name: string) => string | null;
  addRoute: (uid: string, route: Route) => string | null;
  removeRoute: (uid: string, index: number) => string | null;
  // 施工を依頼する。時間が止まっていて設定が「確認する」なら、確認を開いて null を返す
  requestBuild: () => string | null;
  abandon: () => string | null;
  load: (save: SaveData) => void;
  snapshot: () => SaveData;
  // 最初から始める（資金・在庫・依頼などを初期状態に戻す）
  newGame: () => void;
  // サンドボックスを新しく始める（案件・依頼・社員はなく、時間は止めたまま）
  // サンドボックスを新しく始める（大きさを省くと既定の大きさ）。資金・機器は捨てる
  newSandbox: (size?: OfficeSize) => void;
  // サンドボックスの床の大きさを変える。狭めてはみ出す機器・家具があれば理由を返す
  resizeSandbox: (size: OfficeSize) => string | null;
}

// 機材または家具の定価（どちらにもないIDは undefined）
const priceOfItem = (id: string): number | undefined => {
  if (id in furniture) return furniture[id as FurnitureId].price;
  if (id in devices) return devices[id as keyof typeof devices].price;
  return undefined;
};

const offerEnv = (maps: Record<string, GameMap>): OfferEnv => ({
  balance,
  fixed: contracts,
  templates: contractTemplates,
  mapOf: (id) => maps[id],
});

const newRng = () => Math.floor(Math.random() * 0x7fffffff) + 1;

// 研修と資格の定義（ゲームデータ）
const trainingEnv: TrainingEnv = { courses: trainingRecord, certs: certRecord, balance };

// 一番手前のウィンドウが機器の画面なら、その選ばれているタブの機器の uid（マップの選択の枠に使う）
export const frontDeviceUid = (s: { windows: WindowItem[] }): string | null => {
  const front = frontWindow(s.windows);
  return front?.kind === 'device' ? front.active : null;
};

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
  companyExp: s.companyExp,
  reputation: s.reputation,
  owned: s.owned,
  completed: s.completed,
  deliveries: s.deliveries,
  familiarity: s.familiarity,
  offers: s.offers,
  active: s.active,
  office: s.office,
  effects: s.effects,
  staff: s.staff,
  staffSeq: s.staffSeq,
  candidates: s.candidates,
  focus: s.focus,
  guidesDone: s.guidesDone,
});

// 依頼の一覧に出す案内（次の依頼までの日数と、届かない理由）
export const offerHintOf = (s: GameState): OfferHint =>
  offerHint(
    {
      minute: s.clock.minute,
      companyExp: s.companyExp,
      completed: s.completed,
      offers: s.offers,
      excluded: s.active.map((p) => p.baseId),
      nextOfferMinute: s.nextOfferMinute,
      offerSeq: s.offerSeq,
      newArrivals: s.newArrivals,
      rng: s.rng,
    },
    offerEnv(s.maps),
  );

// 依頼の追加を1回分進める。受注中の案件と同じ依頼は出さない
const refresh = (s: GameState): Partial<GameState> => {
  // 依頼はサンドボックスには出さない
  if (s.clock.bankrupt || s.mode === 'sandbox') return {};
  const r = refreshOffers(
    {
      minute: s.clock.minute,
      companyExp: s.companyExp,
      completed: s.completed,
      offers: s.offers,
      excluded: s.active.map((p) => p.baseId),
      nextOfferMinute: s.nextOfferMinute,
      offerSeq: s.offerSeq,
      newArrivals: s.newArrivals,
      rng: s.rng,
    },
    offerEnv(s.maps),
  );
  // 一度に2件以上届いたら、依頼の一覧を開いたときに知らせる（件数）
  const added = r.offers.length - s.offers.length;
  return {
    offers: [...r.offers],
    nextOfferMinute: r.nextOfferMinute,
    offerSeq: r.offerSeq,
    newArrivals: r.newArrivals,
    rng: r.rng,
    offerBurst: added >= 2 ? Math.max(added, s.offerBurst) : s.offerBurst,
  };
};

// 検収の結果を画面の状態に反映する（パケット・納品後の表示・失敗の印）
// 解放の一覧（品目の unlockLevel）。レベルが上がったとき、そのレベルで解放されたものを出すのに使う
// 解放の一覧（品目の unlockLevel）。自社の情報の画面（次に解放される物）でも使う
export const unlockItems: UnlockItem[] = [
  ...Object.values(devices).map((d) => ({ kind: 'device' as const, id: d.id, unlockLevel: d.unlockLevel })),
  ...Object.values(cables).map((c) => ({ kind: 'cable' as const, id: c.id, unlockLevel: c.unlockLevel })),
  ...Object.values(furniture).map((f) => ({ kind: 'furniture' as const, id: f.id, unlockLevel: f.unlockLevel })),
  ...contractTemplates.filter((t) => t.announce).map((t) => ({ kind: 'template' as const, id: t.id, unlockLevel: t.unlockLevel })),
  ...contracts.map((c) => ({ kind: 'contract' as const, id: c.id, unlockLevel: c.unlockLevel })),
];

// 納品で会社のレベルが上がったら、上がった各レベルの報酬（お金・機器）を足し、解放の一覧を報告に付ける（N45）
// サンドボックスの拡張の設定。解放のレベルを外す（費用は呼び出し側で打ち消す。N59）
const SANDBOX_EXPAND_CONFIG = { ...balance.office, expand: { ...balance.office.expand, unlockLevels: [] } };

const withLevelUps = (prev: GameState, patch: Partial<GameState>): Partial<GameState> => {
  const report = patch.lastReport;
  const nextExp = patch.companyExp;
  if (!report || !report.passed || nextExp === undefined || nextExp <= prev.companyExp) return patch;
  const ups = levelUpsBetween(levelOf(prev.companyExp, balance), levelOf(nextExp, balance), balance, levelMilestones, unlockItems);
  if (ups.length === 0) return patch;
  const owned = { ...(patch.owned ?? prev.owned) };
  for (const u of ups) for (const d of u.devices) owned[d.device] = (owned[d.device] ?? 0) + d.count;
  return {
    ...patch,
    clock: applyMoney(patch.clock ?? prev.clock, ups.reduce((sum, u) => sum + u.money, 0), 'reward'),
    owned,
    lastReport: { ...report, levelUps: ups },
  };
};

const reportState = (report: Report | undefined): Partial<GameState> => {
  if (!report) return {};
  return {
    lastReport: report,
    traces: report.traces,
    showcase: report.passed ? (report.delivered ?? null) : null,
    check: report.passed ? null : (report.check ?? null),
    helpUid: null,
  };
};

// 動かした・大きさを変えたウィンドウの位置を覚え、端末に保存する
const rememberWin = (memory: WindowMemory, windows: WindowItem[], id: number): WindowMemory => {
  const win = windows.find((w) => w.id === id);
  if (!win) return memory;
  const next = remember(memory, win);
  writeMemory(next);
  return next;
};

export const useGameStore = create<GameState>((set, get) => {
  // 配線・セグメントの設定の後に、IPアドレスの自動割り当てをかける（設定がオフなら何もしない）。同じ操作として取り消しに残る
  // 詳しくで選んだネットワークを、そのセグメントのポートから探す
  const plannedOf = (seg: { members: { node: string; port: number }[] }): PlannedNet | undefined => {
    for (const m of seg.members) {
      const p = get().planned[plannedKey(m.node, m.port)];
      if (p) return p;
    }
    return undefined;
  };
  const withAutoIp = (o: Outcome, target: NetTarget): Outcome =>
    o.ok ? { ...o, core: autoAssign(o.core, gameEnv, target, loadSettings().autoIp, plannedOf) } : o;

  // 案件の操作の結果を状態に反映する。失敗なら理由を返す
  // 機器の位置（失敗の吹き出しを出す場所）
  const tileOf = (uid: string) => {
    const n = focusedProject(get())?.nodes.find((x) => x.uid === uid) ?? get().office.nodes.find((x) => x.uid === uid);
    return n ? { tx: n.x, ty: n.y } : undefined;
  };

  // 設計の操作を履歴に積む。操作の前後の状態から、資金・在庫・費用の差分を取って積む。操作が成功したときだけ積む
  const recorded = (run: () => string | null): string | null => {
    const key = historyKeyOf(focusedProject(get()));
    const before = coreOf(get());
    const reason = run();
    if (reason === null) {
      const entry = entryOf(before, coreOf(get()));
      set((s) => ({
        histories: { ...s.histories, [key]: pushHistory(s.histories[key] ?? emptyHistory(), entry) },
        historyError: null,
      }));
    }
    return reason;
  };

  // 履歴を消す（施工の依頼・取り消し・自社案件の受注）
  const dropHistory = (key: string) =>
    set((s) => ({ histories: Object.fromEntries(Object.entries(s.histories).filter(([k]) => k !== key)) }));

  // 元に戻す・やり直す。いまの設計の対象の履歴を1つ動かし、差分を反映する。資金か在庫が足りなければ戻さず、理由を残す
  const stepHistory = (dir: 'undo' | 'redo') => {
    const s = get();
    const core = coreOf(s);
    const key = historyKeyOf(focusedProject(s));
    const h = s.histories[key];
    if (!h) return;
    const r = dir === 'undo' ? undoHistory(h) : redoHistory(h);
    if (!r) return;
    const res = stepDesign(core, r.entry, dir);
    if (!res.ok) {
      if (res.reason === dir) set({ historyError: dir });
      return;
    }
    const next = res.core;
    // テストの結果と、選んでいる途中の配線・ポップアップは、戻した設計では無効になる
    set({
      clock: next.clock,
      owned: next.owned,
      active: next.active,
      office: next.office,
      histories: { ...s.histories, [key]: r.history },
      historyError: null,
      check: null,
      helpUid: null,
      lastError: null,
      wireStart: null,
      portMenu: null,
    });
  };

  const apply = (outcome: Outcome, at?: { tx: number; ty: number }): string | null => {
    if (!outcome.ok) {
      const flash = at ? { key: `ui.error.${outcome.reason}`, ...at, at: Date.now() } : null;
      set({ lastError: outcome.reason, ...(flash ? { flash } : {}) });
      return outcome.reason;
    }
    const c = outcome.core;
    // サンドボックスは資金を減らさない（費用は差し引かない）。床の機器・配線を変えたら、テストの結果は無効になる
    const sandbox = get().mode === 'sandbox';
    // 設計（機器・配線・セグメント）を変えたら、最後のテストの結果は無効になる
    const before = focusedProject(get());
    const after = focusedProject(c);
    const redesigned =
      before !== null &&
      after !== null &&
      before.id === after.id &&
      (before.nodes !== after.nodes || before.links !== after.links || before.segments !== after.segments);
    set(withLevelUps(get(), {
      lastError: null,
      ...(redesigned || (sandbox && c.office !== get().office) ? { check: null, helpUid: null } : {}),
      clock: sandbox ? get().clock : c.clock,
      companyExp: c.companyExp,
      reputation: c.reputation,
      owned: c.owned,
      completed: c.completed,
      deliveries: c.deliveries,
      familiarity: c.familiarity,
      offers: c.offers,
      active: c.active,
      focus: c.focus,
      office: c.office,
      effects: c.effects,
      staff: c.staff,
      staffSeq: c.staffSeq,
      candidates: c.candidates,
      ...reportState(outcome.report),
    }));
    return null;
  };

  // 施工を依頼する（確認を通したあとの処理）
  const buildNow = (): string | null => {
    const focusId = focusedProject(get())?.id;
    const r = requestBuild(coreOf(get()), gameEnv);
    // テストに合格していないと施工を依頼できない。案内を出し、テストのボタンを光らせる
    if (!r.ok && r.reason === 'untested') {
      const at = Date.now();
      set({ lastError: r.reason, testNudge: at, notice: { key: 'ui.error.untested', params: {}, id: at } });
      return r.reason;
    }
    set({ traces: [] });
    const reason = apply(r);
    // 施工を依頼したら、その案件の履歴は消す（施工後は戻せない）
    if (reason === null && focusId) dropHistory(projectHistoryKey(focusId));
    return reason;
  };

  return {
    mode: 'career',
    clock: initialClock(balance),
    companyExp: 0,
    reputation: 0,
    expDay: 0,
    expToday: 0,
    debugGuide: null,
    owned: { ...balance.initialStock },
    completed: [],
    deliveries: 0,
    familiarity: EMPTY_FAMILIARITY,
    arpTable: {},
    macTable: {},
    offers: [],
    nextOfferMinute: 0,
    offerSeq: 0,
    newArrivals: {},
    offerBurst: 0,
    planned: {},
    ...newStart(),
    candidates: [],
    active: [],
    focus: null,
    office: initialOffice(balance),
    effects: noEffects(),
    guidesDone: [],
    guideTarget: null,
    setGuideTarget: (uid) => set({ guideTarget: uid }),
    debugAddMoney: (amount) => set((s) => ({ clock: { ...s.clock, money: s.clock.money + amount } })),
    debugSetCompanyLevel: (level) => {
      const s = get();
      const exp = expAtLevel(level, balance);
      const ups = levelUpsBetween(levelOf(s.companyExp, balance), levelOf(exp, balance), balance, levelMilestones, unlockItems);
      const owned = { ...s.owned };
      for (const u of ups) for (const d of u.devices) owned[d.device] = (owned[d.device] ?? 0) + d.count;
      set({
        companyExp: exp,
        owned,
        clock: applyMoney(s.clock, ups.reduce((sum, u) => sum + u.money, 0), 'reward'),
      });
    },
    debugAddOwned: (device, count) => set((s) => ({ owned: { ...s.owned, [device]: (s.owned[device] ?? 0) + count } })),
    debugSetMinute: (minute) => set((s) => ({ clock: { ...s.clock, minute } })),
    markGuideDone: (contractId) => {
      if (get().guidesDone.includes(contractId)) return;
      set((s) => ({ guidesDone: [...s.guidesDone, contractId] }));
      get().grantCompanyExp('guide');
    },
    debugResetGuides: () => set({ guidesDone: [] }),
    debugRefreshOffers: () => set((s) => refresh({ ...s, nextOfferMinute: s.clock.minute })),
    debugFinishBuild: () => {
      // 施工の進みは時間で決まるため、既存の tick を速い速さで回す（速さは終わったら戻す）
      const before = get().speed;
      set({ speed: 4, nightSpeed: null });
      for (let i = 0; i < 200000 && get().lastReport === null && get().active.some((p) => p.phase === 'build'); i++) get().tick();
      set({ speed: before });
    },
    debugStartGuide: (contractId, step) => {
      const s = get();
      const steps = guides[contractId];
      // 手順の番号（1〜手順の数）と案件を確かめてから動く
      if (!steps || step < 1 || step > steps.length) return 'none';
      const fixed = offerEnv(s.maps).fixed.find((c) => c.id === contractId);
      if (!fixed) return 'none';
      const focused = focusedProject(s);
      if (!(focused && focused.baseId === contractId && focused.phase === 'design')) {
        // 依頼の一覧になければ、この案件の依頼を作る。受注できるかを先に確かめ、できないときは何も変えない
        const existing = s.offers.find((o) => o.kind === 'fixed' && o.baseId === contractId);
        const offer = existing ?? { id: fixed.id, kind: 'fixed' as const, baseId: fixed.id, params: {}, contract: fixed, arrivedMinute: s.clock.minute };
        const offers = existing ? s.offers : [...s.offers, offer];
        // 担当は、空いている社員全員（受注の画面と同じ既定）
        const busy = s.active.flatMap((p) => p.crew);
        const crew = s.staff.filter((m) => !busy.includes(m.uid) && m.training === null).map((m) => m.uid);
        const probe = accept({ ...coreOf(s), offers }, offer.id, balance.office.projectSlots, crew);
        if (!probe.ok) return probe.reason;
        set({ offers });
        const reason = get().accept(offer.id, crew);
        if (reason) return reason;
      }
      set((st) => ({ guidesDone: st.guidesDone.filter((g) => g !== contractId), debugGuide: { id: contractId, step } }));
      return null;
    },
    debugMarkGuideDone: (contractId) =>
      // 経験値は増やさない（既存の markGuideDone は案内の経験値を入れるため使わない）
      set((st) => (st.guidesDone.includes(contractId) ? {} : { guidesDone: [...st.guidesDone, contractId] })),
    debugConsumeGuide: () => set({ debugGuide: null }),
    grantCompanyExp: (source) => {
      const s = get();
      // サンドボックスは育成がないため、経験値は入れない
      if (s.mode === 'sandbox') return;
      const r = grantDailyExp(s, source, s.clock.minute, balance);
      if (r.gained === 0) return;
      // 納品と同じく、上がったレベルの報酬（お金・機器）を受け取る
      const ups = levelUpsBetween(levelOf(s.companyExp, balance), levelOf(r.companyExp, balance), balance, levelMilestones, unlockItems);
      const owned = { ...s.owned };
      for (const u of ups) for (const d of u.devices) owned[d.device] = (owned[d.device] ?? 0) + d.count;
      set({
        companyExp: r.companyExp,
        expDay: r.expDay,
        expToday: r.expToday,
        owned,
        clock: applyMoney(s.clock, ups.reduce((sum, u) => sum + u.money, 0), 'reward'),
      });
    },
    speed: 1,
    nightSpeed: null,
    pausedPrompt: false,
    maps: { hq: mapOfOffice(initialOffice(balance)) },
    lastReport: null,
    notice: null,
    dismissReport: () => set({ lastReport: null, showcase: null, traces: [] }),
    dismissNotice: () => set({ notice: null }),
    histories: {},
    undo: () => stepHistory('undo'),
    redo: () => stepHistory('redo'),
    historyError: null,
    lastError: null,
    windows: [],
    windowSeq: 0,
    windowMemory: readMemory(),
    placing: null,
    wireCable: 'utp_cat5e',
    traces: [],
    showcase: null,
    check: null,
    helpUid: null,
    setHelpUid: (uid) => set({ helpUid: uid }),
    testNudge: 0,
    test: () => {
      const s = get();
      // サンドボックスは、案件の達成条件なしで、PC とサーバーの疎通を判定する
      if (s.mode === 'sandbox') {
        const sr = sandboxTest(s.office, gameEnv);
        if (!sr) {
          set({ lastError: 'none' });
          return 'none';
        }
        set({
          lastError: null,
          traces: sr.traces,
          check: { projectId: 'hq', goals: sr.goals },
          helpUid: null,
          notice: { key: sr.passed ? 'ui.sandbox.testOk' : 'ui.sandbox.testNg', params: {}, id: Date.now() },
        });
        return null;
      }
      const r = testDesign(coreOf(get()), gameEnv);
      if (!r.ok) {
        set({ lastError: r.reason });
        return r.reason;
      }
      set({
        lastError: null,
        active: r.core.active,
        traces: r.result.traces,
        check: { projectId: r.core.focus ?? '', goals: r.result.goals },
        helpUid: null,
      });
      return null;
    },
    tool: 'select',
    // 道具を変えると、配線の途中・一覧・置く予定の機材を取り消す。選択の道具以外では機器の画面を閉じる
    setTool: (tool) => {
      const s = get();
      if (s.tool === tool && !s.placing) return;
      set({ tool, placing: null, wireStart: null, portMenu: null });
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
    // 名前とIPアドレスの表示は端末ごとの設定に保存する（設定の画面と同じ値）
    showIp: loadSettings().showIp,
    setShowIp: (on) => {
      set({ showIp: on });
      saveSettings({ showIp: on });
    },
    taskOpen: true,
    setTaskOpen: (open) => set({ taskOpen: open }),
    flash: null,
    linkPulse: null,
    payWarned: null,
    openWindow: (kind, ref) => {
      const s = get();
      const list = openWindowOp({ windows: s.windows, seq: s.windowSeq }, kind, ref, viewportNow(), s.windowMemory);
      set({ windows: list.windows, windowSeq: list.seq });
    },
    toggleWindow: (kind, ref) => {
      const s = get();
      const list = toggleWindowOp({ windows: s.windows, seq: s.windowSeq }, kind, ref, viewportNow(), s.windowMemory);
      set({ windows: list.windows, windowSeq: list.seq });
    },
    closeWindow: (id) => {
      const list = closeWindowOp({ windows: get().windows, seq: get().windowSeq }, id);
      set({ windows: list.windows });
    },
    fitWindows: () => {
      const s = get();
      const list = fitWindowsOp({ windows: s.windows, seq: s.windowSeq }, viewportNow());
      if (list.windows !== s.windows) set({ windows: list.windows });
    },
    closeTab: (id, ref) => {
      const list = closeTabOp({ windows: get().windows, seq: get().windowSeq }, id, ref);
      set({ windows: list.windows });
    },
    selectTab: (id, ref) => {
      const list = selectTabOp({ windows: get().windows, seq: get().windowSeq }, id, ref);
      set({ windows: list.windows });
    },
    reorderTab: (id, from, to) => {
      const list = reorderTabOp({ windows: get().windows, seq: get().windowSeq }, id, from, to);
      set({ windows: list.windows });
    },
    focusWindow: (id) => {
      const list = focusWindowOp({ windows: get().windows, seq: get().windowSeq }, id);
      set({ windows: list.windows });
    },
    moveWindow: (id, x, y) => {
      const s = get();
      const vp = viewportNow();
      const list = moveWindowOp({ windows: s.windows, seq: s.windowSeq }, id, x, y, vp);
      if (list.windows === s.windows) return;
      set({ windows: list.windows, windowMemory: rememberWin(s.windowMemory, list.windows, id) });
    },
    placeWindow: (id, rect) => {
      const s = get();
      const vp = viewportNow();
      const list = placeWindowOp({ windows: s.windows, seq: s.windowSeq }, id, rect, vp);
      if (list.windows === s.windows) return;
      set({ windows: list.windows, windowMemory: rememberWin(s.windowMemory, list.windows, id) });
    },
    resizeWindow: (id, w, h) => {
      const s = get();
      const vp = viewportNow();
      const list = resizeWindowOp({ windows: s.windows, seq: s.windowSeq }, id, w, h, vp);
      if (list.windows === s.windows) return;
      set({ windows: list.windows, windowMemory: rememberWin(s.windowMemory, list.windows, id) });
    },
    setPlacing: (deviceId) => set({ placing: deviceId }),
    itemDrag: null,
    setItemDrag: (itemDrag) => set({ itemDrag }),
    setWireCable: (cableId) => set({ wireCable: cableId }),
    tick: () =>
      set((s) => {
        // 納品の結果画面を開いている間は、時間を止める（閉じると、今の速度で続きから進む）
        if (s.showcase) return {};
        // 給与を払えない月は、給与が払われる直前に一度だけ時間を止める（設定でオフにできる）。止めた後の再開では止めず、そのまま払う
        const payday = (s.clock.paidMonths + 1) * minutesPerMonth(balance);
        if (
          s.speed > 0 &&
          !s.clock.bankrupt &&
          loadSettings().payPause &&
          s.payWarned !== s.clock.paidMonths &&
          s.clock.minute + balance.time.gameMinutesPerTick >= payday &&
          s.clock.money < totalSalary(s.staff, balance.nightPayRate)
        ) {
          return { speed: 0, payWarned: s.clock.paidMonths, notice: { key: 'ui.notice.payPause', params: {}, id: Date.now() } };
        }
        const ticked = advanceTick(s.clock, balance, totalSalary(s.staff, balance.nightPayRate));
        // 貸し出しの収入（日が替わるたびに、その日の分を受け取る。障害の日は入らない）。月末に漏れがあれば評判が1下がる
        const days = Math.floor(ticked.minute / minutesPerDay) - Math.floor(s.clock.minute / minutesPerDay);
        const months = ticked.paidMonths - s.clock.paidMonths;
        const rent = days > 0 && !ticked.bankrupt && s.mode === 'career' ? rentalOf(s.office, gameEnv.engine, balance.rental, levelOf(s.companyExp, balance), balance.time.daysPerMonth) : null;
        const clock = rent !== null && rent.daily > 0 ? applyMoney(ticked, rent.daily * days, 'rental') : ticked;
        let next: Partial<GameState> = { clock, ...(rent?.penalty && months > 0 ? { reputation: Math.max(0, s.reputation - months) } : {}) };
        // 月末に給与を払ったら知らせる
        if (clock.paidMonths > s.clock.paidMonths) {
          const amount = totalSalary(s.staff, balance.nightPayRate);
          // 毎月1日に、採用の候補を作り直す
          const rolled = rollCandidates(levelOf(s.companyExp, balance), clock.paidMonths, s.rng, balance, s.staff.map((m) => m.name));
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
              companyExp: r.core.companyExp,
              reputation: r.core.reputation,
              completed: r.core.completed,
              deliveries: r.core.deliveries,
              familiarity: r.core.familiarity,
              active: r.core.active,
              focus: r.core.focus,
              staff: r.core.staff,
              office: r.core.office,
              effects: r.core.effects,
              ...reportState(r.report),
            };
          }
        }
        // 勤務時間外に施工中なら最速にし、勤務時間になるか施工が終わったら元の速さへ戻す
        const activeNow = next.active ?? s.active;
        // 勤務中の社員が1人もいなければ早送りする（夜勤の社員がいるときは、夜も速さを変えない・N48）
        const minuteOfDay = clock.minute % minutesPerDay;
        const staffNow = next.staff ?? s.staff;
        const night = nightSpeedStep({
          working: staffNow.some((m) => isOnShift(minuteOfDay, m.shift, balance)),
          building: activeNow.some((p) => p.phase === 'build'),
          speed: s.speed,
          saved: s.nightSpeed,
          fastest: Math.max(...balance.time.speeds),
        });
        if (night.speed !== s.speed || night.saved !== s.nightSpeed) {
          next = { ...next, speed: night.speed as Speed, nightSpeed: night.saved as Speed | null };
        }
        const merged = { ...s, ...next } as GameState;
        return { ...withLevelUps(s, next), ...refresh(merged) };
      }),
    // 速さを人が変えたら、勤務時間外の自動の早送りは取り消す（覚えた速さには戻さない）
    // サンドボックスは時間を止めたままにする
    setSpeed: (speed) => set({ speed: get().mode === 'sandbox' ? 0 : speed, nightSpeed: null }),
    cacheMap: (map) =>
      set((s) => {
        const maps = { ...s.maps, [map.id]: map };
        return { maps, ...refresh({ ...s, maps }) };
      }),
    buy: (deviceId) => {
      const s = get();
      // 機材・家具の定価。どちらにもないIDは買えない（黙って0円にしない）
      const listPrice = priceOfItem(deviceId);
      if (listPrice === undefined) return false;
      // サンドボックスは購入の費用を 0 とする（在庫は増える）
      const price = s.mode === 'sandbox' ? 0 : listPrice;
      const result = buyDevice(s.clock.money, s.owned, deviceId, price);
      if (!result.ok) return false;
      // 購入は費用に入れない。案件の費用は納品のときに、置かれている機器の定価と配線の費用から決める
      set({ clock: applyMoney(s.clock, result.money - s.clock.money, 'purchase'), owned: result.owned });
      return true;
    },
    sell: (deviceId) => {
      const s = get();
      if (s.mode === 'sandbox') return false;
      const price = priceOfItem(deviceId);
      if (price === undefined) return false;
      const result = sellDevice(s.clock.money, s.owned, deviceId, price, balance.sellRate);
      if (!result.ok) return false;
      set({ clock: applyMoney(s.clock, result.money - s.clock.money, 'sale'), owned: result.owned });
      return true;
    },
    useBlueprint: () => recorded(() => apply(applyBlueprintOp(coreOf(get()), gameEnv))),
    acceptDelegated: (offerId, crew) => {
      const reason = apply(acceptDelegatedOp(coreOf(get()), offerId, balance.office.projectSlots, crew, gameEnv));
      if (reason === null && get().speed !== 0 && loadSettings().designPause) get().setSpeed(0);
      return reason;
    },
    accept: (offerId, crew) => {
      const inhouse = get().offers.find((o) => o.id === offerId)?.contract.inhouse === true;
      const reason = apply(accept(coreOf(get()), offerId, balance.office.projectSlots, crew));
      // 自社案件は自社オフィスを引き継ぐ。取り消しで自社オフィスを戻すと引き継いだ内容が壊れるため、自社オフィスの履歴は消す
      if (reason === null && inhouse) dropHistory(OFFICE_HISTORY_KEY);
      // 設定がオンなら、受注して設計に入ったときに時間を止める（配線は時間に追われずに進める）
      if (reason === null && get().speed !== 0 && loadSettings().designPause) get().setSpeed(0);
      return reason;
    },
    // 在庫の機材・家具を配置する（購入はショップで行う）。案件がなければ自社オフィスに置く
    place: (deviceId, x, y) => {
      if (deviceId in furniture) return get().placeFurniture(deviceId, x, y);
      if (get().active.length === 0) {
        const hq = get().maps.hq;
        if (!hq) return 'map';
        return recorded(() => apply(placeInOffice(coreOf(get()), deviceId, x, y, hq, gameEnv, get().mode === 'sandbox'), { tx: x, ty: y }));
      }
      const map = get().maps[focusedProject(get())!.contract.map];
      if (!map) return 'map';
      return recorded(() => apply(placeDevice(coreOf(get()), deviceId, x, y, map, gameEnv), { tx: x, ty: y }));
    },
    expandOffice: (side) => {
      const office = get().office;
      // 失敗の吹き出しは、広げる辺の内側の壁のマスに出す（広げる前の大きさで決める）
      const at = {
        tx: side === 'right' ? office.size.w + 1 : side === 'left' ? 0 : Math.floor((office.size.w + 2) / 2),
        ty: side === 'bottom' ? office.size.h + 1 : Math.floor((office.size.h + 2) / 2),
      };
      // サンドボックスは、解放（レベル）も費用も問わず広げる。拡張の上限は通常と同じ（N59）。費用は、資金を変えないよう一時的に大きな資金で計算してから戻す
      const sandboxExpand = get().mode === 'sandbox';
      const core = coreOf(get());
      const outcome = sandboxExpand
        ? expandOfficeOp({ ...core, clock: { ...core.clock, money: Number.MAX_SAFE_INTEGER } }, side, SANDBOX_EXPAND_CONFIG, 0)
        : expandOfficeOp(core, side, balance.office, levelOf(get().companyExp, balance));
      const restored: Outcome = outcome.ok && sandboxExpand ? { ...outcome, core: { ...outcome.core, clock: { ...outcome.core.clock, money: core.clock.money } } } : outcome;
      const reason = apply(restored, at);
      if (reason !== null) return reason;
      get().grantCompanyExp('expansion');
      // 部屋の大きさが変わったので、マップを作り直す。広げる前の操作の取り消しは、座標が合わないため消す
      dropHistory(OFFICE_HISTORY_KEY);
      set((s) => ({ maps: { ...s.maps, hq: mapOfOffice(s.office) } }));
      return null;
    },
    placeFurniture: (id, x, y) => {
      const hq = get().maps.hq;
      if (!hq) return 'map';
      const reason = recorded(() => apply(placeFurnitureOp(coreOf(get()), id, x, y, hq), { tx: x, ty: y }));
      if (reason === null) get().grantCompanyExp('furniture');
      return reason;
    },
    removeFurniture: (uid) => {
      const f = get().office.furniture.find((x) => x.uid === uid);
      return recorded(() => apply(removeFurnitureOp(coreOf(get()), uid), f ? { tx: f.x, ty: f.y } : undefined));
    },
    hire: (candidateUid, shift) => {
      const reason = apply(hireOp(coreOf(get()), candidateUid, (id) => furniture[id as FurnitureId]?.seat === true, staffCapOf(levelOf(get().companyExp, balance), balance), shift));
      if (reason === null) get().grantCompanyExp('hire');
      return reason;
    },
    connect: (aUid, bUid, cableId, ports = {}) => {
      const reason = recorded(() => apply(withAutoIp(connect(coreOf(get()), aUid, bUid, cableId, gameEnv, netTargetOf(get()), ports), netTargetOf(get())), tileOf(bUid)));
      // つながった音と、つなげなかった音（効果音の設定がオフのときは鳴らない）
      if (reason === null) {
        playConnect();
        set({ linkPulse: { a: aUid, b: bUid, at: Date.now() } });
      } else {
        playFail();
      }
      return reason;
    },
    removeLink: (uid) => recorded(() => apply(removeLink(coreOf(get()), uid, netTargetOf(get()), gameEnv))),
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
      const reason = recorded(() => {
        if (get().active.length === 0) {
          const n = get().office.nodes.find((x) => x.uid === uid);
          return apply(removeFromOffice(coreOf(get()), uid, gameEnv), n ? { tx: n.x, ty: n.y } : undefined);
        }
        return apply(removeNode(coreOf(get()), uid, gameEnv), tileOf(uid));
      });
      // 撤去した機器のタブは閉じる（最後のタブならウィンドウも閉じる）
      if (reason === null) set((s) => ({ windows: closeRef({ windows: s.windows, seq: s.windowSeq }, 'device', uid).windows }));
      return reason;
    },
    setIface: (uid, port, ip, prefix = 24) =>
      recorded(() => apply(setInterface(coreOf(get()), uid, port, ip, prefix, gameEnv, netTargetOf(get())), tileOf(uid))),
    setGateway: (uid, gateway) => recorded(() => apply(setGateway(coreOf(get()), uid, gateway, netTargetOf(get())), tileOf(uid))),
    setFirewallRules: (uid, rules) => recorded(() => apply(setFirewallRules(coreOf(get()), uid, rules, netTargetOf(get())), tileOf(uid))),
    clearOfferBurst: () => set({ offerBurst: 0 }),
    declineOffer: (id) => set({ offers: declineOffer(get().offers, id) }),
    setPlanned: (uid, port, net) =>
      set((s) => {
        const key = plannedKey(uid, port);
        const next = { ...s.planned };
        if (net) next[key] = net;
        else delete next[key];
        return { planned: next };
      }),
    setSegment: (uid, port, network, prefix) =>
      recorded(() =>
        apply(withAutoIp(setSegment(coreOf(get()), uid, port, network, prefix, gameEnv, netTargetOf(get())), netTargetOf(get())), tileOf(uid)),
      ),
    replug: (linkUid, end, port) =>
      recorded(() => apply(replug(coreOf(get()), linkUid, end, port, gameEnv, netTargetOf(get())))),
    // 移動の地図は、設計中の案件のマップ（なければ自社オフィスの hq）
    moveNode: (uid, x, y) => {
      const map = get().maps[focusedProject(get())?.contract.map ?? 'hq'];
      if (!map) return 'map';
      return recorded(() => apply(moveNode(coreOf(get()), uid, x, y, gameEnv, netTargetOf(get()), map, get().mode === 'sandbox'), tileOf(uid)));
    },
    moveFurniture: (uid, x, y) => {
      const hq = get().maps.hq;
      if (!hq) return 'map';
      return recorded(() => apply(moveFurnitureOp(coreOf(get()), uid, x, y, hq), { tx: x, ty: y }));
    },
    replugTo: (linkUid, end, nodeUid, port) =>
      recorded(() => apply(replugTo(coreOf(get()), linkUid, end, nodeUid, port, gameEnv, netTargetOf(get())), tileOf(nodeUid))),
    setService: (uid, protocol, on) =>
      recorded(() => apply(setService(coreOf(get()), uid, protocol, on, netTargetOf(get())), tileOf(uid))),
    setHostname: (uid, hostname) => recorded(() => apply(setHostnameOp(coreOf(get()), uid, hostname, netTargetOf(get())), tileOf(uid))),
    setNameServer: (uid, ip) => recorded(() => apply(setNameServerOp(coreOf(get()), uid, ip, netTargetOf(get())), tileOf(uid))),
    learnPing: (srcUid, dstUid) => {
      const s = get();
      const net = editNetOf(s);
      if (!net) return;
      const r = learnFromPing(net.nodes, net.links, gameEnv.engine, srcUid, dstUid);
      if (r.arp === null && r.macs.length === 0) return;
      const netKey = s.focus ?? 'office';
      const arpKey = `${netKey}:${srcUid}`;
      const arp = r.arp === null ? (s.arpTable[arpKey] ?? []) : [...(s.arpTable[arpKey] ?? []).filter((x) => x.ip !== r.arp?.ip), r.arp];
      const macTable = { ...s.macTable };
      for (const { switchUid, entry } of r.macs) {
        const k = `${netKey}:${switchUid}`;
        macTable[k] = [...(macTable[k] ?? []).filter((x) => x.port !== entry.port), entry];
      }
      set({ arpTable: { ...s.arpTable, [arpKey]: arp }, macTable });
    },
    setDnsRole: (uid, on) => recorded(() => apply(setDnsRoleOp(coreOf(get()), uid, on, netTargetOf(get())), tileOf(uid))),
    autoRegisterZone: (uid) => recorded(() => apply(autoRegisterZoneOp(coreOf(get()), uid, netTargetOf(get())), tileOf(uid))),
    setName: (uid, name) => recorded(() => apply(setNameOp(coreOf(get()), uid, name, netTargetOf(get())), tileOf(uid))),
    setHost: (uid, name, ip) => recorded(() => apply(setHostOp(coreOf(get()), uid, name, ip, netTargetOf(get())), tileOf(uid))),
    removeHost: (uid, name) => recorded(() => apply(removeHostOp(coreOf(get()), uid, name, netTargetOf(get())), tileOf(uid))),
    addRoute: (uid, route) => recorded(() => apply(addRoute(coreOf(get()), uid, route, netTargetOf(get())), tileOf(uid))),
    removeRoute: (uid, index) => recorded(() => apply(removeRoute(coreOf(get()), uid, index, netTargetOf(get())), tileOf(uid))),
    requestBuild: () => {
      const s = get();
      // 時間が止まっているときは、設定に従って確認を出すか、速さを決めてから施工を依頼する
      if (s.speed === 0 && requestBuild(coreOf(s), gameEnv).ok) {
        const mode = loadSettings().pausedBuild;
        if (mode === 'ask') {
          set({ pausedPrompt: true });
          return null;
        }
        if (mode === 'play') get().setSpeed(1);
      }
      return buildNow();
    },
    answerPausedBuild: (mode, remember) => {
      set({ pausedPrompt: false });
      if (remember) saveSettings({ pausedBuild: mode });
      if (mode === 'play') get().setSpeed(1);
      buildNow();
    },
    abandon: () => {
      const focusId = focusedProject(get())?.id;
      const reason = apply(abandon(coreOf(get())));
      if (reason === null && focusId) dropHistory(projectHistoryKey(focusId));
      return reason;
    },
    load: (save) =>
      set({
        mode: save.mode,
        clock: save.clock,
        companyExp: save.companyExp,
        reputation: save.reputation,
        expDay: save.expDay,
        expToday: save.expToday,
        owned: save.owned,
        completed: save.completed,
        deliveries: save.deliveries,
        familiarity: save.familiarity,
        offers: save.offers as Offer[],
        nextOfferMinute: save.nextOfferMinute,
        offerSeq: save.offerSeq,
        newArrivals: save.newArrivals,
        rng: save.rng,
        active: save.active,
        focus: save.focus,
        office: save.office,
        effects: save.effects,
        staff: save.staff,
        staffSeq: save.staffSeq,
        candidates: save.candidates,
        guidesDone: save.guidesDone,
        maps: { ...get().maps, hq: mapOfOffice(save.office) },
        guideTarget: null,
        lastReport: null,
        showcase: null,
        traces: [],
        wireStart: null,
        portMenu: null,
        check: null,
        helpUid: null,
        histories: {},
        historyError: null,
        windows: [],
      }),
    newGame: () =>
      set((s) => {
        const base: Partial<GameState> = {
          mode: 'career',
          clock: initialClock(balance),
          companyExp: 0,
          reputation: 0,
          expDay: 0,
          expToday: 0,
          owned: { ...balance.initialStock },
          completed: [],
          deliveries: 0,
          familiarity: EMPTY_FAMILIARITY,
          offers: [],
          nextOfferMinute: 0,
          offerSeq: 0,
          newArrivals: {},
          offerBurst: 0,
          ...newStart(),
          candidates: [],
          active: [],
          focus: null,
          office: initialOffice(balance),
          effects: noEffects(),
          guidesDone: [],
          maps: { ...s.maps, hq: mapOfOffice(initialOffice(balance)) },
          guideTarget: null,
          lastReport: null,
          lastError: null,
          traces: [],
          showcase: null,
          check: null,
          helpUid: null,
          histories: {},
          historyError: null,
          windows: [],
          placing: null,
          wireStart: null,
          portMenu: null,
          speed: 1,
          nightSpeed: null,
          pausedPrompt: false,
        };
        // 新しく始めたら、最初の依頼をすぐ届ける
        return { ...base, ...refresh({ ...s, ...base } as GameState) };
      }),
    newSandbox: (size) =>
      set((s) => {
        const office = sandboxOffice(size);
        return {
          mode: 'sandbox',
          clock: sandboxClock(initialClock(balance)),
          companyExp: 0,
          reputation: 0,
          expDay: 0,
          expToday: 0,
          owned: {},
          completed: [],
          deliveries: 0,
          familiarity: EMPTY_FAMILIARITY,
          offers: [],
          nextOfferMinute: 0,
          offerSeq: 0,
          newArrivals: {},
          offerBurst: 0,
          rng: newRng(),
          staff: [],
          staffSeq: 0,
          candidates: [],
          active: [],
          focus: null,
          office,
          effects: noEffects(),
          guidesDone: [],
          guideTarget: null,
          maps: { ...s.maps, hq: mapOfOffice(office) },
          speed: 0,
          nightSpeed: null,
          pausedPrompt: false,
          lastReport: null,
          lastError: null,
          notice: null,
          flash: null,
          traces: [],
          showcase: null,
          check: null,
          helpUid: null,
          histories: {},
          historyError: null,
          windows: [],
          placing: null,
          wireStart: null,
          portMenu: null,
        };
      }),
    resizeSandbox: (size) => {
      if (get().mode !== 'sandbox') return 'none';
      const office = get().office;
      const result = resizeSandboxOffice(office, size);
      if (!result.ok) return result.reason;
      // 床の大きさが変わったので、マップを作り直す。広げる前の操作の取り消しは、座標が合わないため消す
      dropHistory(OFFICE_HISTORY_KEY);
      set({ office: result.office, maps: { ...get().maps, hq: mapOfOffice(result.office) } });
      return null;
    },
    snapshot: () => {
      const s = get();
      return {
        mode: s.mode,
        clock: s.clock,
        companyExp: s.companyExp,
        reputation: s.reputation,
        expDay: s.expDay,
        expToday: s.expToday,
        owned: s.owned,
        completed: s.completed,
        deliveries: s.deliveries,
        familiarity: s.familiarity,
        offers: s.offers,
        nextOfferMinute: s.nextOfferMinute,
        offerSeq: s.offerSeq,
        newArrivals: s.newArrivals,
        rng: s.rng,
        active: s.active,
        focus: s.focus,
        office: s.office,
        effects: s.effects,
        staff: s.staff,
        staffSeq: s.staffSeq,
        candidates: s.candidates,
        guidesDone: s.guidesDone,
      };
    },
  };
});

// 検収に合格して納品したら、ジングルを鳴らす（状態の変化を見て鳴らすので、計算の部分は音を知らない）
useGameStore.subscribe((s, prev) => {
  if (s.lastReport && s.lastReport !== prev.lastReport && s.lastReport.passed) playDeliver();
});
