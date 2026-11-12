// ゲーム全体の状態。時間・資金・評判・在庫・完了案件・依頼・受注中の案件・速度を持ち、Tick ごとに進める。
import type { PlannedNet } from './gameHelpers';
import { loadSettings } from '../settings/settings';
import { playDeliver } from '../audio/sfx';
import { create } from 'zustand';
import { balance } from 'virtual:game-data';
import { initialClock, type ClockState } from '../sim/clock';
import type { Offer } from '../contracts/template';
import type { GameMap, JobId, Staff } from '../data/schema';
import { DEFAULT_COMPANY_NAME, type GameMode, type SandboxLesson } from '../services/migrations';

import { type NoticeItem } from '../ui/notices';
import { EMPTY_FAMILIARITY, type Familiarity } from '../sim/familiar';
import type { MacEntry } from '../network/mac';
import { mapOfOffice } from '../sim/office';
import { type DesignEntry, type History } from '../sim/history';
import { createWindowsSlice, type WindowsSlice } from './slices/windowsSlice';
import { createDesignSlice, type DesignSlice } from './slices/designSlice';
import { createStaffSlice, type StaffSlice } from './slices/staffSlice';
import { createOfficeSlice, type OfficeSlice } from './slices/officeSlice';
import { createContractSlice, type ContractSlice } from './slices/contractSlice';
import { createEconomySlice, type EconomySlice } from './slices/economySlice';
import { createUiSlice, type UiSlice } from './slices/uiSlice';
import { createDebugSlice, type DebugSlice } from './slices/debugSlice';
import { createSessionSlice, type SessionSlice } from './slices/sessionSlice';
export { frontDeviceUid, viewportNow } from './slices/windowsSlice';
import { initialOffice } from '../sim/furniture';
import { type Project, type Office, type Effects, noEffects, type GoalCheck, type Report, type Trace } from '../sim/project';

import { runTick } from './tickSystems';
import { newStart, refresh } from './gameHelpers';
import type { VlanWarning } from '../network/netState';
export { coreOf, editNetOf, focusedProject, netTargetOf, offerHintOf, purchaseDiscountOf, unlockItems, viewingOffice } from './gameHelpers';
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

export type Speed = 0 | 1 | 2 | 4 | 8;

export type { PlannedNet } from './gameHelpers';
export { plannedKey } from './gameHelpers';

export interface GameState extends WindowsSlice, DesignSlice, StaffSlice, OfficeSlice, ContractSlice, EconomySlice, UiSlice, DebugSlice, SessionSlice {
  // 詳しくで選んだネットワーク（画面の状態。セーブには入らない）。キーは plannedKey
  planned: Record<string, PlannedNet>;
  // 遊び方（career は案件の経営ゲーム、sandbox は自由に設計する練習場）。セーブデータに入る
  mode: GameMode;
  // 社名（N133）
  name: string;
  clock: ClockState;
  companyExp: number;
  // 評判（★の数の積み上げ。解放の条件には使わない。N55）
  reputation: number;
  // 今日（ゲームの日）に経験値を得た量。1日の上限（balance.exp.dailyCap）に使う（N55）
  expDay: number;
  expToday: number;
  // デバッグ（N54）: 案内を開始する手順（一度だけ使う。保存しない）
  debugGuide: { id: string; step: number } | null;
  // サンドボックスで開いている教材（null は自由な設計。セーブに入る）
  sandboxLesson: SandboxLesson | null;
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
  // 次の月の募集の職種の指定（人事がいるときだけ。月が替わると消える。保存しない）
  hiringWish: JobId | null;
  // 初めての概念の案内を終えた（または飛ばした）固定案件のID（セーブデータに入る）
  guidesDone: string[];
  // 案内が光らせている機器の uid（マップの描画は別の担当。保存しない）
  guideTarget: string | null;
  speed: Speed;
  // 勤務時間外の早送りで、自動で変える前の速さ（自動で変えていなければ null。保存しない）
  nightSpeed: Speed | null;
  // 一時停止から戻る先の速さ。停止以外の速さに変えたときに覚える（保存しない）
  resumeSpeed: Speed;
  // 時間が止まっているときの施工の確認を開いているか（保存しない）
  pausedPrompt: boolean;
  // 読み込み済みのマップ（保存しない）
  maps: Record<string, GameMap>;
  // 直近の検収結果（保存しない）
  lastReport: Report | null;
  // ターミナルなどから実行した通信を画面に流す（保存しない）
  showTrace: (trace: Trace) => void;
  // 画面に出す通知の列（給与の支払いなど。N96）。保存しない
  notices: NoticeItem[];
  // 設計の取り消しの履歴（案件ごと・自社オフィスごと）。保存しない
  histories: Record<string, History<DesignEntry>>;
  // 資金か在庫が足りず、元に戻せなかった・やり直せなかったとき、その種類（保存しない）
  historyError: 'undo' | 'redo' | null;
  // 直近に失敗した操作の理由（保存しない）
  lastError: string | null;
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
  // 配線の途中の起点（ポートを選んだ機器）と、ポートの一覧の吹き出し（保存しない）
  wireStart: WireStart | null;
  portMenu: PortMenuState | null;
  // 最後のテストまたは検収の判定（案件ごと）。設計を変えると消える（保存しない）
  check: { projectId: string; goals: GoalCheck[]; warnings?: VlanWarning[] } | null;
  // 失敗の直し方を開いている機器（保存しない）
  helpUid: string | null;
  // 施工を断られた回数。テストのボタンを1秒光らせるために使う（保存しない）
  testNudge: number;
  // 機器の名前とIPアドレスを表示するか、案件の内容を開いているか（保存しない）
  showIp: boolean;
  taskOpen: boolean;
  // 失敗した操作の理由を、失敗した地点（マップのタイル）に出す
  flash: { key: string; tx: number; ty: number; at: number } | null;
  // 直近につないだ2つの機器と時刻。つながった瞬間に、ケーブルの上を光が走らせる（画面だけの表示）
  linkPulse: { a: string; b: string; at: number } | null;
  // 給与を払えない月に、払う前に時間を止めた月（paidMonths の値）。同じ月は、もう止めない（保存しない）
  payWarned: number | null;
  // インベントリの欄から品目をドラッグしている間の位置（保存しない）
  itemDrag: ItemDrag | null;
  tick: () => void;
  cacheMap: (map: GameMap) => void;
}

export const useGameStore = create<GameState>((set, get, api) => {
  return {
    ...createWindowsSlice(set, get, api),
    ...createDesignSlice(set, get, api),
    ...createStaffSlice(set, get, api),
    ...createOfficeSlice(set, get, api),
    ...createContractSlice(set, get, api),
    ...createEconomySlice(set, get, api),
    ...createUiSlice(set, get, api),
    ...createDebugSlice(set, get, api),
    ...createSessionSlice(set, get, api),
    mode: 'career',
    name: DEFAULT_COMPANY_NAME,
    clock: initialClock(balance),
    companyExp: 0,
    reputation: 0,
    expDay: 0,
    expToday: 0,
    debugGuide: null,
    sandboxLesson: null,
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
    hiringWish: null,
    active: [],
    focus: null,
    office: initialOffice(balance),
    effects: noEffects(),
    guidesDone: [],
    guideTarget: null,
    speed: 0,
    nightSpeed: null,
    resumeSpeed: 1,
    pausedPrompt: false,
    maps: { hq: mapOfOffice(initialOffice(balance)) },
    lastReport: null,
    showTrace: (trace) => set({ traces: [trace] }),
    notices: [],
    histories: {},
    historyError: null,
    lastError: null,
    placing: null,
    wireCable: 'utp_cat5e',
    traces: [],
    showcase: null,
    check: null,
    helpUid: null,
    testNudge: 0,
    tool: 'select',
    wireStart: null,
    portMenu: null,
    // 名前とIPアドレスの表示は端末ごとの設定に保存する（設定の画面と同じ値）
    showIp: loadSettings().showIp,
    taskOpen: true,
    flash: null,
    linkPulse: null,
    payWarned: null,
    itemDrag: null,
    tick: () => set((s) => runTick(s, { now: Date.now(), payPause: loadSettings().payPause })),
    cacheMap: (map) =>
      set((s) => {
        const maps = { ...s.maps, [map.id]: map };
        return { maps, ...refresh({ ...s, maps }) };
      }),
  };
});

// 検収に合格して納品したら、ジングルを鳴らす（状態の変化を見て鳴らすので、計算の部分は音を知らない）
useGameStore.subscribe((s, prev) => {
  if (s.lastReport && s.lastReport !== prev.lastReport && s.lastReport.passed) playDeliver();
});
