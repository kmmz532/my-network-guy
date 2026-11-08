// ゲーム全体の状態。時間・資金・評判・在庫・完了案件・依頼・受注中の案件・速度を持ち、Tick ごとに進める。
import type { PlannedNet } from './gameHelpers';
import { loadSettings } from '../settings/settings';
import { playDeliver } from '../audio/sfx';
import { create } from 'zustand';
import { balance } from 'virtual:game-data';
import { advanceTick, initialClock, minutesPerDay, minutesPerMonth, toDate, type ClockState } from '../sim/clock';
import { isOnShift } from '../sim/shift';
import { nightSpeedStep } from '../sim/nightSpeed';
import type { Offer } from '../contracts/template';
import type { GameMap, JobId, Staff } from '../data/schema';
import { gainExp, rollCandidates, totalSalary } from '../sim/staff';
import { levelOf } from '../sim/level';
import { finishTrainings } from '../sim/training';
import { DEFAULT_COMPANY_NAME, type GameMode } from '../services/migrations';
import { gameEnv, isPcDevice } from '../sim/env';
import { rentalOf } from '../network/external';
import { applyMoney } from '../sim/ledger';

import { unlockedSpeedsOf } from '../sim/speed';
import { pushNotice, type NoticeItem } from '../ui/notices';
import { busyStaff } from '../sim/crew';
import { tDyn } from '../i18n/t';
import { settleRetirements } from '../sim/retire';
import { backOfficeP, devDailyIncome, hrCandidateBonus, hrJuniorRate, hrTrainingRate, isBackOffice } from '../sim/backOffice';
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
import { initialOffice, bonusEnvOf, pcDesksOf } from '../sim/furniture';
import { advanceBuild, type Project, type Office, type Effects, noEffects, type GoalCheck, type Report, type Trace } from '../sim/project';

import { coreOf, newStart, refresh, reportState, salesArrivalPatch, trainingEnv, withLevelUps } from './gameHelpers';
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
  // 時間が止まっているときの施工の確認を開いているか（保存しない）
  pausedPrompt: boolean;
  // 読み込み済みのマップ（保存しない）
  maps: Record<string, GameMap>;
  // 直近の検収結果（保存しない）
  lastReport: Report | null;
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
  check: { projectId: string; goals: GoalCheck[] } | null;
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
    pausedPrompt: false,
    maps: { hq: mapOfOffice(initialOffice(balance)) },
    lastReport: null,
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
          return { speed: 0, payWarned: s.clock.paidMonths, notices: pushNotice(s.notices, 'payPause', {}, Date.now()) };
        }
        const ticked = advanceTick(s.clock, balance, totalSalary(s.staff, balance.nightPayRate));
        // 貸し出しの収入（日が替わるたびに、その日の分を受け取る。障害の日は入らない）。月末に漏れがあれば評判が1下がる
        const days = Math.floor(ticked.minute / minutesPerDay) - Math.floor(s.clock.minute / minutesPerDay);
        const months = ticked.paidMonths - s.clock.paidMonths;
        const rent = days > 0 && !ticked.bankrupt && s.mode === 'career' ? rentalOf(s.office, gameEnv.engine, balance.rental, levelOf(s.companyExp, balance), balance.time.daysPerMonth) : null;
        const rentedClock = rent !== null && rent.daily > 0 ? applyMoney(ticked, rent.daily * days, 'rental') : ticked;
        // システムエンジニアは、担当でない日に開発の収入を得る（担当の日は施工の経験値）
        const crewUids = busyStaff(s);
        // 机の上の PC（N102）。システムエンジニア・人事・経理は、自分の机に PC がないと働けない（収入・経験値・効果が出ない）
        const pcDesks = pcDesksOf(s.office, isPcDevice);
        const hasPc = (m: Staff): boolean => m.desk !== null && pcDesks.includes(m.desk);
        const devIdle = days > 0 && s.mode === 'career' ? s.staff.filter((m) => m.job === 'dev' && m.training === null && !crewUids.has(m.uid) && hasPc(m)) : [];
        const devIncome = devIdle.reduce((sum, m) => sum + devDailyIncome(m, balance) * days, 0);
        const clock = devIncome > 0 ? applyMoney(rentedClock, devIncome, 'dev') : rentedClock;
        // 内勤は、出勤した日ごとに経験値を得る（施工の経験値は得ない）。日が替わるたびに受け取る
        // 内勤と、担当でない日のシステムエンジニアは、日ごとに経験値を得る
        const devIdleUids = new Set(devIdle.map((m) => m.uid));
        // 日ごとの経験値（N102）: 内勤は出勤した日（営業はPCがなくても、人事・経理とシステムエンジニアは PC のある机のみ）。現場のエンジニアは、担当でない日に PC があれば自習で少し
        const dailyExpOf = (m: Staff): number | null => {
          if (devIdleUids.has(m.uid)) return balance.backOffice.dailyExp * days;
          if (isBackOffice(m.job)) return m.shift === 'day' && m.training === null && (m.job === 'sales' || hasPc(m)) ? balance.backOffice.dailyExp * days : null;
          if (m.job !== 'dev' && m.training === null && !crewUids.has(m.uid) && hasPc(m)) return balance.backOffice.dailyExp * balance.deskPc.engineerDailyExpRate * days;
          return null;
        };
        const backOfficeStaff = days > 0 && s.mode === 'career' ? s.staff.map((m) => {
          const exp = dailyExpOf(m);
          return exp === null ? m : gainExp(m, exp, balance.staff.expPerLevel);
        }) : s.staff;
        let next: Partial<GameState> = {
          clock,
          ...(rent?.penalty && months > 0 ? { reputation: Math.max(0, s.reputation - months) } : {}),
          ...(backOfficeStaff !== s.staff ? { staff: backOfficeStaff } : {}),
        };
        // 月末に給与を払ったら知らせる
        // 人事の効果（候補・研修・新人の施工）の大きさ。内勤の実効 level の合計
        const hrP = backOfficeP(s.staff, 'hr', s.office, bonusEnvOf({ staff: s.staff, office: s.office }, gameEnv));
        if (clock.paidMonths > s.clock.paidMonths) {
          const amount = totalSalary(s.staff, balance.nightPayRate);
          // 退職の予定の社員は、今月末で退職する（退職金を払い、一覧から外す。今月の給与は上で払い済み・N90）
          const settled = settleRetirements({ clock: next.clock ?? clock, staff: next.staff ?? s.staff, active: s.active }, balance);
          next = { ...next, clock: settled.clock, staff: settled.staff, active: settled.active };
          // 退職した社員を知らせる（N97）
          for (const m of (next.staff ?? s.staff).length < (s.staff.length) ? s.staff.filter((x) => x.leaving) : []) {
            next = { ...next, notices: pushNotice(next.notices ?? s.notices, 'retired', { name: tDyn(m.name), uid: m.uid }, Date.now()) };
          }
          // 毎月1日に、採用の候補を作り直す
          // 募集の職種の指定は、人事がいるときだけ効く。指定は次の1回だけ使う
          const rolled = rollCandidates(levelOf(s.companyExp, balance), clock.paidMonths, s.rng, balance, s.staff.map((m) => m.name), {
            ...hrCandidateBonus(hrP, balance),
            ...(hrP > 0 && s.hiringWish !== null ? { wish: s.hiringWish } : {}),
          });
          next = {
            ...next,
            notices: pushNotice(pushNotice(next.notices ?? s.notices, 'salary', { amount }, Date.now()), 'candidatesRefreshed', {}, Date.now()),
            candidates: rolled.candidates,
            hiringWish: null,
            rng: rolled.rng,
          };
        }
        // 研修の期日が来た社員は、経験値を得て研修を終える
        const trainedStaff = finishTrainings(coreOf({ ...s, ...next } as GameState), trainingEnv, hrTrainingRate(hrP, balance)).staff;
        if (trainedStaff !== s.staff) {
          next = { ...next, staff: trainedStaff };
          // 研修が終わった社員を知らせる（N97）
          for (const m of trainedStaff) {
            const before = s.staff.find((x) => x.uid === m.uid);
            if (before?.training && !m.training) next = { ...next, notices: pushNotice(next.notices ?? s.notices, 'trained', { name: tDyn(m.name), uid: m.uid }, Date.now()) };
          }
        }
        const withClock = { ...s, ...next } as GameState;
        // 施工中なら、勤務時間内に作業を進める
        if (!clock.bankrupt && withClock.active.some((p) => p.phase === 'build')) {
          const hour = toDate(clock.minute, balance).hour;
          const r = advanceBuild(coreOf(withClock), { ...gameEnv, mapOf: (id) => s.maps[id] }, hour, hrJuniorRate(hrP, balance));
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
          fastest: Math.max(...unlockedSpeedsOf(levelOf(s.companyExp, balance), balance)),
        });
        if (night.speed !== s.speed || night.saved !== s.nightSpeed) {
          next = { ...next, speed: night.speed as Speed, nightSpeed: night.saved as Speed | null };
        }
        const merged = { ...s, ...next } as GameState;
        const refreshed = refresh(merged);
        // 営業の依頼は、通常の到着のあとに、日ごとの確率で届く
        const salesPatch = salesArrivalPatch({ ...merged, ...refreshed } as GameState, days);
        const result = { ...withLevelUps(s, next), ...refreshed, ...salesPatch };
        // 出来事の通知（N97）: 営業の依頼が届いた（件数をまとめる）・新しい依頼が届いた
        const before = refreshed.offers ?? merged.offers;
        const salesCount = (salesPatch.offers?.length ?? before.length) - before.length;
        const refreshCount = (refreshed.offers?.length ?? merged.offers.length) - merged.offers.length;
        let notices = result.notices ?? s.notices;
        if (salesCount > 0) notices = pushNotice(notices, 'salesArrival', { count: salesCount }, Date.now());
        if (refreshCount > 0) notices = pushNotice(notices, 'offersRefreshed', {}, Date.now());
        // 上限に達して、昇給を待っている社員（N97・N101）。この時間で上限に達した社員だけ知らせる
        for (const m of result.staff ?? s.staff) {
          const before = s.staff.find((x) => x.uid === m.uid);
          if (before && before.level < before.levelCap && m.level >= m.levelCap) {
            notices = pushNotice(notices, 'raiseWaiting', { name: tDyn(m.name), uid: m.uid }, Date.now());
          }
        }
        return { ...result, notices };
      }),
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
