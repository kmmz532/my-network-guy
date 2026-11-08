// ゲームの状態から値を引く関数と、状態の一部を作る関数（ストアとスライスが共通で使う）。
import { balance, cables, certs as certRecord, contracts, contractTemplates, devices, furniture, levelMilestones, training as trainingRecord } from 'virtual:game-data';
import type { FurnitureId } from '../generated/ids';
import { offerHint, refreshOffers, salesArrival, type OfferEffects, type OfferEnv, type OfferHint, type OfferState } from '../contracts/offers';
import { rand } from '../sim/rng';
import type { GameMap, Staff } from '../data/schema';
import { initialStaff, staffCapOf } from '../sim/staff';
import { levelOf, levelUpsBetween, type UnlockItem } from '../sim/level';
import { type TrainingEnv } from '../sim/training';
import type { NetLink, NetNode } from '../network/types';
import { gameEnv } from '../sim/env';
import { applyMoney } from '../sim/ledger';
import { pushNotice } from '../ui/notices';
import { accountingRate, backOfficeP, printerArrivalBonusOf, salesArrivalChance } from '../sim/backOffice';
import { assignDesks, initialOffice, bonusEnvOf } from '../sim/furniture';
import { type NetTarget, type Core, type Project, type Office, type Report } from '../sim/project';
import type { GameState } from './useGameStore';

export interface PlannedNet {
  network: string;
  prefix: number;
}
export const plannedKey = (uid: string, port: number): string => `${uid}:${port}`;

// 機材または家具の定価（どちらにもないIDは undefined）
export const priceOfItem = (id: string): number | undefined => {
  if (id in furniture) return furniture[id as FurnitureId].price;
  if (id in devices) return devices[id as keyof typeof devices].price;
  return undefined;
};

export const offerEnv = (maps: Record<string, GameMap>): OfferEnv => ({
  balance,
  fixed: contracts,
  templates: contractTemplates,
  mapOf: (id) => maps[id],
});

export const newRng = () => Math.floor(Math.random() * 0x7fffffff) + 1;

// 研修と資格の定義（ゲームデータ）
export const trainingEnv: TrainingEnv = { courses: trainingRecord, certs: certRecord, balance };

export const netTargetOf = (s: { active: Project[]; focus: string | null }): NetTarget =>
  focusedProject(s) ? 'focus' : 'office';

// いま設計・表示している案件（なければ null）
export const focusedProject = (s: { active: Project[]; focus: string | null }): Project | null =>
  s.focus === null ? null : (s.active.find((p) => p.id === s.focus) ?? null);

// 機器を編集できる対象の機器と配線（自社オフィス、または設計中の案件）。編集できなければ null
// 営業の効果（1日に依頼が届く確率と、報酬の高い依頼の重み。内勤の実効 level の合計で決まる）
export const salesEffectsOf = (s: { staff: Staff[]; office: Office }): OfferEffects => {
  const P = backOfficeP(s.staff, 'sales', s.office, bonusEnvOf({ staff: s.staff, office: s.office }, gameEnv));
  // プリンターの効果（N98）は、営業の人数と関係なく効く
  const printer = printerArrivalBonusOf(s.office, (d) => gameEnv.devices[d]?.category === 'printer', balance);
  return { arrivalChance: salesArrivalChance(P, balance) + printer, rewardWeight: P * balance.backOffice.sales.rewardWeightPerLevel };
};

// 営業の依頼の到着（日ごとの確率）。日が替わった分だけ振り、届いた依頼は通常の一覧に入る
export const salesArrivalPatch = (s: GameState, days: number): Partial<GameState> => {
  const fx = salesEffectsOf(s);
  if (days <= 0 || fx.arrivalChance <= 0 || s.mode !== 'career' || s.clock.bankrupt) return {};
  let state: OfferState = {
    minute: s.clock.minute,
    companyExp: s.companyExp,
    completed: s.completed,
    offers: s.offers,
    excluded: s.active.map((p) => p.baseId),
    nextOfferMinute: s.nextOfferMinute,
    offerSeq: s.offerSeq,
    newArrivals: s.newArrivals,
    rng: s.rng,
  };
  const env = offerEnv(s.maps);
  for (let d = 0; d < days; d++) {
    const roll = rand(state.rng);
    state = { ...state, rng: roll.state };
    if (roll.value < fx.arrivalChance) state = salesArrival(state, env, fx.rewardWeight);
  }
  return { offers: [...state.offers], offerSeq: state.offerSeq, newArrivals: state.newArrivals, rng: state.rng };
};

// 購入の割引（経理の効果。内勤の実効 level の合計で決まる）
export const purchaseDiscountOf = (s: { staff: Staff[]; office: Office }): number =>
  accountingRate(backOfficeP(s.staff, 'accounting', s.office, bonusEnvOf({ staff: s.staff, office: s.office }, gameEnv)), balance);

// 画面が自社オフィスを見ているか（N112）。判定はここだけで行う（案件の数では決めない）
export const viewingOffice = (s: { focus: string | null; showcase: unknown }): boolean => s.focus === null && !s.showcase;

export const editNetOf = (s: GameState): { nodes: NetNode[]; links: NetLink[] } | null => {
  if (viewingOffice(s)) return { nodes: s.office.nodes, links: s.office.links };
  const p = focusedProject(s);
  return p?.phase === 'design' ? { nodes: p.nodes, links: p.links } : null;
};

// 新しいゲームの乱数と初期の社員
export const newStart = () => {
  const init = initialStaff(balance, newRng());
  // 初めの社員は、初めの机に座る（並び順）
  const staff = assignDesks(init.staff, initialOffice(balance), (id) => furniture[id as FurnitureId]?.seat === true);
  return { rng: init.rng, staff, staffSeq: init.staffSeq };
};

export const coreOf = (s: GameState): Core => ({
  clock: s.clock,
  companyExp: s.companyExp,
  reputation: s.reputation,
  owned: s.owned,
  completed: s.completed,
  deliveries: s.deliveries,
  familiarity: s.familiarity,
  purchaseDiscount: purchaseDiscountOf(s),
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
export const refresh = (s: GameState): Partial<GameState> => {
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
    salesEffectsOf(s),
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
  // 自社の床の種類（木以外。N92）
  ...balance.floors.filter((f) => f.id !== 'wood').map((f) => ({ kind: 'floor' as const, id: f.id, unlockLevel: f.unlockLevel })),
  // 機能の解放（床の変更・夜勤など）。鍵は balance.featureUnlocks から作り、手で並べない（N127）
  ...Object.entries(balance.featureUnlocks).map(([id, unlockLevel]) => ({ kind: 'feature' as const, id, unlockLevel })),
  // 早送りの速さ（4倍・8倍。N99）
  ...Object.entries(balance.time.speedUnlockLevels).map(([id, unlockLevel]) => ({ kind: 'speed' as const, id, unlockLevel })),
];

// 納品で会社のレベルが上がったら、上がった各レベルの報酬（お金・機器）を足し、解放の一覧を報告に付ける（N45）
// サンドボックスの拡張の設定。解放のレベルを外す（費用は呼び出し側で打ち消す。N59）
export const SANDBOX_EXPAND_CONFIG = { ...balance.office, expand: { ...balance.office.expand, unlockLevels: [] } };

// 任せた依頼の納品は、結果画面を出さずに通知で伝える。レベルアップしたときだけ結果画面を出す（レベルアップの報告を付ける）
export const withDelegatedNotice = (prev: GameState, patch: Partial<GameState>): Partial<GameState> => {
  const report = patch.lastReport;
  if (!report?.delegated || (report.levelUps ?? []).length > 0) return patch;
  return {
    ...patch,
    lastReport: null,
    notices: pushNotice(patch.notices ?? prev.notices, 'delegated', { money: report.money ?? 0 }, Date.now()),
  };
};

// 雇える人数が増えたら知らせる（レベルアップで上限が上がったとき・N97）
export const withCapNotice = (prev: GameState, patch: Partial<GameState>): Partial<GameState> => {
  const before = staffCapOf(levelOf(prev.companyExp, balance), balance);
  const after = staffCapOf(levelOf(patch.companyExp ?? prev.companyExp, balance), balance);
  if (after <= before) return patch;
  return { ...patch, notices: pushNotice(patch.notices ?? prev.notices, 'capRaised', { cap: after }, Date.now()) };
};

export const withLevelUps = (prev: GameState, patch: Partial<GameState>): Partial<GameState> => withCapNotice(prev, withDelegatedNotice(prev, attachLevelUps(prev, patch)));

export const attachLevelUps = (prev: GameState, patch: Partial<GameState>): Partial<GameState> => {
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

export const reportState = (report: Report | undefined): Partial<GameState> => {
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