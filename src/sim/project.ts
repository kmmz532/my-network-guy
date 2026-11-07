// 案件の流れ（受注・設計・施工・検収・納品）。状態を受け取り、新しい状態を返す純粋関数で書く。
// 設計は機器の配置・配線・IP設定、施工は社員が作業時間をかけて行い、検収で達成条件を判定する。
import { applyMoney, recordSaving } from './ledger';
import { isBackOffice } from './backOffice';
import type { Balance, Contract, Furniture, GameMap, Staff } from '../data/schema';
import { tileKind } from '../data/tileKind';
import { furnitureOf } from '../contracts/layout';
import { renameNode } from '../network/nodeName';
import { nextHostname } from '../network/hostname';
import { nextMacSerial } from '../network/mac';
import type { Offer } from '../contracts/template';
import { evaluateContract } from '../network/goals';
import { ipToInt, linkLength } from '../network/engine';
import { compile, type IssueDetail } from '../network/compile';
import {
  PREFIX_MAX,
  PREFIX_MIN,
  fillSegments,
  hostCapacity,
  intToIp,
  networkAddress,
  segmentConfigOf,
  segmentOf,
  segmentsOf,
  type Segment,
} from '../network/segments';
import type {
  EngineData,
  FailureReason,
  FirewallRule,
  Iface,
  NetLink,
  NetNode,
  PathResult,
  Route,
  SegmentConfig,
  Service,
  HostEntry,
} from '../network/types';
import type { ClockState } from './clock';
import { isOnShift } from './shift';
import { rate, rewardRateOf } from './rating';
import { DELEGATE_MIN_COUNT, DELEGATED_EXP_DIVISOR, DELEGATED_STAR_CAP, familiarKeyOf, missingFixed, positionsMatch, recordDelivery, type Blueprint, type Familiarity } from './familiar';
import { dueDayOf, lateDaysOf, lateFactor } from './deadline';
import { furnitureBonus, type BonusEnv } from './furniture';
import { gainExp, staffPower } from './staff';
import { blindDelegation, type Stars } from './blindDelegate';
import { CATEGORY } from '../data/categories';
import { checkCableLength } from './cableLength';
import { deliveryExpOf, levelOf, type LevelUp } from './level';

export interface Project {
  id: string;
  kind: 'fixed' | 'template';
  baseId: string;
  params: Record<string, number>;
  contract: Contract;
  nodes: NetNode[];
  links: NetLink[];
  // 追加する機器・配線の連番（uid に使う）
  seq: number;
  // 受注してから購入・配線にかかった費用
  cost: number;
  // 検収に失敗した回数
  rework: number;
  // 社員に任せた依頼（N70）。★は2が上限、経験値は半分
  delegated?: boolean;
  // 型紙なしで任せた依頼の結果（受注のときに決め、施工が終わったら納品する）
  blind?: BlindPlan;
  // 施工済みの機器・配線の uid（差分だけを施工するため）
  built: { nodes: string[]; links: string[] };
  // 自社案件で、自社オフィスから引き継いだ機器の uid（取り消しても在庫に戻さない）
  inherited?: string[];
  // 自社案件で、自社オフィスから引き継いだ配線の uid（撤去できない）
  inheritedLinks?: string[];
  phase: 'design' | 'build';
  progress: number;
  total: number;
  // 期日（ゲーム内の日の番号）。期日のない案件は null
  due: number | null;
  // 担当の社員（uid）。施工の進みと経験値は担当の社員だけに効く
  crew: string[];
  // セグメントの設定（代表端点の鍵 "uid:port" → ネットワークアドレスとプレフィックス長）
  segments?: Record<string, SegmentConfig>;
  // 最後のテストに合格したか。設計を変えると false に戻る。施工は true のときだけ依頼できる
  testedOk: boolean;
}

// 型紙なしで任せた依頼の結果（★・費用の割合・手直しの回数）
export interface BlindPlan {
  stars: Stars;
  costRatio: number;
  rework: number;
}

export interface ReportFailure {
  reason: string;
  node: string;
  goal: string;
}

// 達成条件ごとの判定（テストと検収で共通）。失敗した機器と理由を持つ。機器のない失敗（件数の不足など）は node を持たない
export interface GoalCheck {
  ok: boolean;
  failures: { node: string; reason: FailureReason }[];
}

// テストの結果（画面に流すパケットと、達成条件ごとの判定）
export interface TestResult {
  passed: boolean;
  goals: GoalCheck[];
  traces: Trace[];
}

// 検収で判定した経路（画面にパケットとして流す）
export interface Trace {
  kind: 'ping' | 'http';
  src: string;
  dst: string;
  result: PathResult;
}

// 案件の費用の内訳。機器は、案件で自分で置いた機器（既設でも引き継いだものでもない）の定価の合計。配線は、配線の費用の合計
export interface ProjectCost {
  total: number;
  devices: number;
  cable: number;
}

export const projectCostOf = (p: Project, env: Env): ProjectCost => {
  // 既設の機器（案件で置かれたもの）と、自社オフィスから引き継いだ機器（前の案件で買った分）は含めない
  const inherited = new Set(p.inherited ?? []);
  const devices = p.nodes.reduce(
    (sum, n) => (n.locked || inherited.has(n.uid) ? sum : sum + (env.devices[n.device]?.price ?? 0)),
    0,
  );
  return { total: devices + p.cost, devices, cable: p.cost };
};

export interface Report {
  // 納品で会社のレベルが上がったときの、各レベルの報酬と解放（N45。ストアで付ける）
  levelUps?: LevelUp[];
  passed: boolean;
  // 納品した案件（納品後の表示に使う）
  delivered?: Project;
  // 任せた依頼の納品。レベルアップがなければ、結果画面は出さずに通知で伝える（ストアで判断する）
  delegated?: boolean;
  // 納品が遅れた日数（期日内なら0）
  lateDays?: number;
  // 費用の内訳（納品のとき）
  costBreakdown?: ProjectCost;
  // 報酬として受け取った機器（インベントリに入る）
  rewardDevices?: { device: string; count: number }[];
  // 結果画面に出す、費用・予算・失敗回数
  cost?: number;
  budget?: number;
  rework?: number;
  // 設計の不備の件数（0件なら★の上限に影響しない）
  designIssues?: number;
  traces: Trace[];
  // 不合格のとき、達成条件ごとの判定（マップの「×」と案件の欄で使う）
  check?: { projectId: string; goals: GoalCheck[] };
  stars?: 1 | 2 | 3;
  money?: number;
  // 評判の増え分（報酬の評判と★による評判の合計）
  expGain?: number;
  failures: ReportFailure[];
}

// 自社オフィスのネットワーク。自社案件の納品で更新され、ずっと残る
// 自社オフィスに置いた家具（机・植木鉢など）
export interface PlacedFurniture {
  uid: string; // "f" + 連番
  id: string; // 家具ID
  x: number;
  y: number;
}

// 床の大きさ（床の内側のマス数。壁は含まない）
export interface OfficeSize {
  w: number;
  h: number;
}

// マップ上のマス（x, y）
export interface OfficeCell {
  x: number;
  y: number;
}

// 部屋の辺（右・下・左）。上（奥の壁）には広げない
export type OfficeSide = 'right' | 'bottom' | 'left';

export interface Office {
  // 部屋の床の大きさ（別室を含む外側の床の大きさ）。マップは大きさから作る
  size: OfficeSize;
  // 内側の壁のマス（床の内側。機器・家具は置けない）
  innerWalls: OfficeCell[];
  // ドアのマス（通れる床として扱う）
  doors: OfficeCell[];
  // 別室を足した辺（1辺に1つまで）
  annexes: OfficeSide[];
  nodes: NetNode[];
  links: NetLink[];
  seq: number;
  furniture: PlacedFurniture[];
  furnitureSeq: number;
  // セグメントの設定（代表端点の鍵 "uid:port" → 設定）
  segments?: Record<string, SegmentConfig>;
}

// 自社案件で得た効果の合計
export interface Effects {
  buildSpeed: number;
}

// 社員の席になる家具（机）のID。PCはこの家具の上にだけ置ける
export const DESK_ID = 'desk';

// 席になる家具（机。定義の seat が true のもの。N44 で机だけの品目も席として数える）。定義がなければ DESK_ID だけを机とする
export const isDeskFurniture = (id: string, env: Env): boolean => (env.furniture?.[id]?.seat ?? false) || id === DESK_ID;

export const emptyOffice = (size: OfficeSize): Office => ({
  size,
  innerWalls: [],
  doors: [],
  annexes: [],
  nodes: [],
  links: [],
  seq: 0,
  furniture: [],
  furnitureSeq: 0,
});
export const noEffects = (): Effects => ({ buildSpeed: 0 });

export interface Core {
  clock: ClockState;
  companyExp: number;
  // 評判（★の数の積み上げ。表示と記録の値で、解放の条件には使わない。N55）
  reputation: number;
  owned: Record<string, number>;
  completed: string[];
  // 納品した案件の数（合格した納品の数。自社の情報の画面に出す。N66）
  deliveries: number;
  // なじみの依頼の回数と型紙（N70）
  familiarity: Familiarity;
  // 経理の割引（配線の費用に掛ける割合。店の割引と同じ値）
  purchaseDiscount: number;
  offers: Offer[];
  // 受注中の案件（複数）
  active: Project[];
  // いま設計・表示している案件のID（設計の操作はこの案件を対象にする）
  focus: string | null;
  office: Office;
  effects: Effects;
  // 雇用中の社員
  staff: Staff[];
  // 社員の uid の連番
  staffSeq: number;
  // 採用の候補（毎月作り直す）
  candidates: Staff[];
  // 初めての概念の案内を終えた（または飛ばした）固定案件のID
  guidesDone: string[];
}

// 機材の性質（ゲームデータから作る）
export interface DeviceInfo {
  category: string;
  price: number;
  portCount: number;
  // 机の上にも床にも置ける（N91）
  deskable?: boolean;
  // 置いたときから動いているサービス（サーバーの HTTP など）。省略すると動いていない
  defaultServices?: Service[];
}

export interface CableInfo {
  pricePerLink: number;
  pricePerTile: number;
  maxLengthTiles: number;
}

export interface Env {
  balance: Balance;
  // 家具の定義（家具の補正に使う）。省略すると補正はない
  furniture?: Record<string, Furniture>;
  devices: Record<string, DeviceInfo>;
  cables: Record<string, CableInfo>;
  engine: EngineData;
}

export type Outcome = { ok: true; core: Core; report?: Report } | { ok: false; reason: string };

const fail = (reason: string): Outcome => ({ ok: false, reason });

// 配線の定価から、払う額（経理の割引のあと）。割引がなければ定価のまま
const paidCable = (core: Core, list: number): number => Math.round(list * (1 - core.purchaseDiscount));

// 増えた機器を型紙につなぐときのケーブル（一番安いもの）
const WIRE_CABLE = 'utp_cat5e';

// 型紙をつなぐ先（N70）: 近くのスイッチかルーターのうち、空きのポートがあるもの。足りない機器は、ここにつなぐ
const isHubCategory = (category: string): boolean =>
  category === CATEGORY.l2Switch || category === CATEGORY.router || category === CATEGORY.l3Switch || category === CATEGORY.routerSwitch;

const hubFor = (nodes: readonly NetNode[], links: readonly NetLink[], from: NetNode, env: Env): NetNode | null => {
  let best: NetNode | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (n.uid === from.uid || !isHubCategory(env.devices[n.device].category)) continue;
    if (usedPorts(links, n).size >= env.devices[n.device].portCount) continue;
    const dist = Math.abs(n.x - from.x) + Math.abs(n.y - from.y);
    if (dist < bestDist) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
};

// 任せられるかの理由（任せられるなら null）（N70）。型紙の固定の機器の位置が合い、増えた機器をつなぐ先があること
export const delegationReason = (familiarity: Familiarity, offer: Offer, env: Env): string | null => {
  if (offer.contract.inhouse) return 'inhouse';
  const key = familiarKeyOf(offer.kind, offer.baseId, offer.contract.map);
  if ((familiarity.counts[key] ?? 0) < DELEGATE_MIN_COUNT) return 'delegate.count';
  const bp = familiarity.blueprints[key];
  if (!bp) return 'delegate.blueprint';
  const fixed = fixedNodes(offer.contract);
  if (!positionsMatch(bp.design, fixed)) return 'delegate.fit';
  const reachable = missingFixed(bp.design, fixed).every((m) => hubFor(bp.design.nodes, bp.design.links, m, env) !== null);
  return reachable ? null : 'delegate.fit';
};

// 型紙を依頼に写す（N70）。型紙の固定の機器は同じ位置にあること。今回の依頼で増えた固定の機器は、同じ種類で置き、近くのスイッチかルーターに配線する
const copyBlueprint = (core: Core, p: Project, bp: Blueprint, env: Env): Outcome => {
  const fixed = fixedNodes(p.contract);
  if (!positionsMatch(bp, fixed)) return fail('delegate.fit');
  const missing = missingFixed(bp, fixed);
  const numbers = [...bp.nodes.map((n) => n.uid), ...bp.links.map((l) => l.uid)].map((u) => Number(/(\d+)$/.exec(u)?.[1] ?? 0));
  const copied: Project = {
    ...p,
    nodes: [...bp.nodes, ...missing],
    links: [...bp.links],
    segments: { ...bp.segments },
    seq: Math.max(p.seq, ...numbers) + 1,
    // 固定の機器は、依頼の時点で置かれている（施工済みとして扱う）。型紙の配線と増えた配線は、施工が必要
    built: { nodes: fixed.map((n) => n.uid), links: [] },
    testedOk: false,
  };
  let next = withProject(core, copied);
  for (const m of missing) {
    const current = next.active.find((x) => x.id === p.id);
    if (!current) return fail('none');
    const hub = hubFor(current.nodes, current.links, m, env);
    if (!hub) return fail('delegate.fit');
    const wired = connect(next, m.uid, hub.uid, WIRE_CABLE, env, 'focus');
    if (!wired.ok) return wired;
    next = wired.core;
  }
  return { ok: true, core: next };
};

// 設計中の案件に型紙を写す（「型紙を使う」）。同じ依頼の型紙が今の機器の置き場所に合うときだけ。写したあとは、テストをやり直す（N70）
export const applyBlueprint = (core: Core, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  if (p.contract.inhouse) return fail('inhouse');
  const bp = core.familiarity.blueprints[familiarKeyOf(p.kind, p.baseId, p.contract.map)];
  if (!bp) return fail('delegate.blueprint');
  return copyBlueprint(core, p, bp.design, env);
};

// 社員に任せて受注する（N70）。型紙を写し、テストを通してから施工に入る。★と経験値の上限は検収で掛ける
export const acceptDelegated = (core: Core, offerId: string, slots: number, crew: string[], env: Env): Outcome => {
  const offer = core.offers.find((o) => o.id === offerId);
  if (!offer) return fail('none');
  const reason = delegationReason(core.familiarity, offer, env);
  if (reason) return fail(reason);
  const accepted = accept(core, offerId, slots, crew);
  if (!accepted.ok) return accepted;
  const bp = core.familiarity.blueprints[familiarKeyOf(offer.kind, offer.baseId, offer.contract.map)].design;
  const p = accepted.core.active.find((x) => x.id === offerId);
  if (!p) return fail('none');
  const copiedOut = copyBlueprint(accepted.core, { ...p, delegated: true }, bp, env);
  if (!copiedOut.ok) return copiedOut;
  const copied = copiedOut.core.active.find((x) => x.id === offerId);
  if (!copied) return fail('none');
  // 写した設計がテストを通らなければ、受注しない（この場合は状態を変えない）
  if (!judge(copied, env).passed) return fail('delegate.test');
  return requestBuild(withProject(copiedOut.core, { ...copied, testedOk: true }), env);
};

// 案件で最初から置かれている機器
const fixedNodes = (contract: Contract): NetNode[] =>
  contract.placed.map((p) => ({
    uid: p.ref,
    device: p.device,
    ...(p.name ? { name: p.name } : {}),
    x: p.x,
    y: p.y,
    locked: p.locked,
    configLocked: p.config?.locked ?? false,
    interfaces: (p.config?.interfaces ?? []).map((i) => ({ ...i })),
    gateway: p.config?.gateway ?? null,
    routes: [],
    services: (p.config?.services ?? []).map((s) => ({ ...s })),
  }));

// 設計・表示の対象の案件を取り出す（なければ null）
export const focusedOf = (core: Core): Project | null =>
  core.focus === null ? null : (core.active.find((p) => p.id === core.focus) ?? null);

// 案件を差し替える（同じIDの案件を置き換える）
const withProject = (core: Core, next: Project): Core => ({
  ...core,
  active: core.active.map((p) => (p.id === next.id ? next : p)),
});

// 案件を外す（納品・取り消し）。外した案件が対象だったら、残りの先頭の案件に切り替える
const removeProject = (core: Core, id: string): Pick<Core, 'active' | 'focus'> => {
  const active = core.active.filter((p) => p.id !== id);
  return { active, focus: core.focus === id ? (active[0]?.id ?? null) : core.focus };
};

// 設計中の案件を取り出す。設計中でなければ理由を返す
const requireDesign = (core: Core): Project | string => {
  const p = focusedOf(core);
  if (!p) return 'none';
  if (p.phase !== 'design') return 'phase';
  return p;
};

// 依頼を受注する。受注できるのは案件の枠（slots）の数まで。受注した案件を設計の対象にする。
// 自社案件は自社オフィスを引き継ぐため、同時に1件まで
export const accept = (core: Core, offerId: string, slots: number, crew: string[]): Outcome => {
  if (core.active.length >= slots) return fail('slots');
  const offer = core.offers.find((o) => o.id === offerId);
  if (!offer) return fail('none');
  // 担当は1人以上。ほかの案件の担当・研修中の社員は選べない
  if (crew.length === 0) return fail('crew');
  const busy = new Set(core.active.flatMap((p) => p.crew));
  const free = (uid: string) => {
    const member = core.staff.find((s) => s.uid === uid);
    // 退職の予定の社員は、新しい案件の担当に選べない（月末までは受注済みの案件を続ける・N90）
    return member !== undefined && member.training === null && !member.leaving && !busy.has(uid);
  };
  if (!crew.every(free)) return fail('crew');
  // 内勤（営業・人事・経理）は、案件の担当に選べない
  const isEngineerCrew = (uid: string) => {
    const member = core.staff.find((s) => s.uid === uid);
    return member !== undefined && !isBackOffice(member.job);
  };
  if (!crew.every(isEngineerCrew)) return fail('crew');
  const inhouse = offer.contract.inhouse;
  if (inhouse && core.active.some((p) => p.contract.inhouse)) return fail('busy');
  const office = core.office;
  // 自社案件は、自社オフィスの機器と配線を引き継いで始める
  const fixed = fixedNodes(offer.contract).filter((n) => !inhouse || !office.nodes.some((o) => o.uid === n.uid));
  const nodes = inhouse ? [...office.nodes, ...fixed] : fixed;
  const links = inhouse ? [...office.links] : [];
  const project: Project = {
    id: offer.id,
    kind: offer.kind,
    baseId: offer.baseId,
    params: offer.params,
    contract: offer.contract,
    nodes,
    links,
    seq: inhouse ? office.seq : 0,
    cost: 0,
    rework: 0,
    // 既設の機器は施工済みとして扱う
    built: { nodes: nodes.map((n) => n.uid), links: links.map((l) => l.uid) },
    inherited: inhouse ? office.nodes.map((n) => n.uid) : [],
    inheritedLinks: inhouse ? office.links.map((l) => l.uid) : [],
    phase: 'design',
    progress: 0,
    total: 0,
    testedOk: false,
    due: dueDayOf(core.clock.minute, offer.contract.deadlineDays),
    crew,
    // 自社案件は、自社オフィスのセグメントの設定を引き継ぐ
    segments: inhouse ? { ...(office.segments ?? {}) } : {},
  };
  return {
    ok: true,
    core: {
      ...core,
      offers: core.offers.filter((o) => o.id !== offerId),
      active: [...core.active, project],
      focus: project.id,
    },
  };
};

// 機材を置いたときに動いているサービス（ゲームデータの defaultServices を写す）
const servicesOf = (env: Env, deviceId: string): Service[] => (env.devices[deviceId]?.defaultServices ?? []).map((s) => ({ ...s }));

// 自社オフィスに機器を置けるかを判定する。置けなければ失敗の理由を返す
// PCは机の家具があり、その上に機器がないマスだけ。PC以外は床で、家具も機器もないマスだけ。
// anyFloor（サンドボックス）のときは、PCは床（家具も機器もないマス）か机の上（機器がないマス）に置ける。机以外の家具の上は置けない
const officePlaceReason = (
  furniture: PlacedFurniture[],
  nodes: NetNode[],
  deviceId: string,
  x: number,
  y: number,
  map: GameMap,
  env: Env,
  anyFloor = false,
): string | null => {
  const hasNode = nodes.some((n) => n.x === x && n.y === y);
  const device = env.devices[deviceId];
  const isPc = device.category === CATEGORY.pc;
  // 机の上にも床にも置ける機器（N91）は、PC のような机の上の判定を使い、床にも置ける。PC でも deskable でもない機器は床だけ
  const desktop = device.deskable === true;
  if (isPc && !desktop && !anyFloor) {
    const onDesk = furniture.some((f) => f.x === x && f.y === y && isDeskFurniture(f.id, env));
    return !onDesk || hasNode ? 'desk' : null;
  }
  const kind = tileKind(map, x, y);
  if (kind !== 'floor') return 'tile';
  if (hasNode) return 'tile';
  const here = furniture.filter((f) => f.x === x && f.y === y);
  if (isPc || desktop) return here.some((f) => !isDeskFurniture(f.id, env)) ? 'tile' : null;
  return here.length > 0 ? 'tile' : null;
};

// 機材を置けるマスか（配置と移動で共通）。自社案件は自社オフィスの規則、それ以外は床（PCは机の上も可）。置けなければ理由を返す
const placeReason = (
  inhouse: boolean,
  furniture: PlacedFurniture[],
  nodes: NetNode[],
  deviceId: string,
  x: number,
  y: number,
  map: GameMap,
  env: Env,
  anyFloor = false,
): string | null => {
  if (inhouse) return officePlaceReason(furniture, nodes, deviceId, x, y, map, env, anyFloor);
  const kind = tileKind(map, x, y);
  const deskOk = env.devices[deviceId].category === CATEGORY.pc || env.devices[deviceId].deskable === true;
  if (kind !== 'floor' && !(kind === 'desk' && deskOk)) return 'tile';
  if (nodes.some((n) => n.x === x && n.y === y)) return 'tile';
  // 依頼先の家具（机・棚・飾り。N76）のあるマスには置けない
  if (furniture.some((f) => f.x === x && f.y === y)) return 'tile';
  return null;
};

// 在庫から機器を1台配置する。自社案件では自社オフィスと同じ規則に従い、ほかの案件では床（PCは机の上も可）に置ける。
export const placeDevice = (core: Core, deviceId: string, x: number, y: number, map: GameMap, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  if (!env.devices[deviceId]) return fail('none');
  if ((core.owned[deviceId] ?? 0) < 1) return fail('stock');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  const furniture = p.contract.inhouse ? core.office.furniture : furnitureOf(map.furniture, p.contract.furniture);
  const reason = placeReason(p.contract.inhouse, furniture, p.nodes, deviceId, x, y, map, env);
  if (reason) return fail(reason);
  const node: NetNode = {
    uid: `u${p.seq}`,
    device: deviceId,
    // ホスト名は種類の略号と番号を自動で付ける（N68）
    hostname: nextHostname(p.nodes, env.devices[deviceId].category),
    macSerial: nextMacSerial(p.nodes),
    x,
    y,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: servicesOf(env, deviceId),
  };
  const next: Project = { ...p, nodes: [...p.nodes, node], seq: p.seq + 1, testedOk: false };
  return {
    ok: true,
    core: { ...withProject(core, next), owned: { ...core.owned, [deviceId]: core.owned[deviceId] - 1 } },
  };
};

// 案件がないときに、在庫の機材を自社オフィスへ置く。配線は自社案件と同じ規則で行う
export const placeInOffice = (core: Core, deviceId: string, x: number, y: number, map: GameMap, env: Env, anyFloor = false): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  if (!env.devices[deviceId]) return fail('none');
  if ((core.owned[deviceId] ?? 0) < 1) return fail('stock');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  const office = core.office;
  const reason = officePlaceReason(office.furniture, office.nodes, deviceId, x, y, map, env, anyFloor);
  if (reason) return fail(reason);
  const node: NetNode = {
    uid: `u${office.seq}`,
    device: deviceId,
    hostname: nextHostname(office.nodes, env.devices[deviceId].category),
    macSerial: nextMacSerial(office.nodes),
    x,
    y,
    locked: false,
    configLocked: false,
    interfaces: [],
    gateway: null,
    routes: [],
    services: servicesOf(env, deviceId),
  };
  return {
    ok: true,
    core: {
      ...core,
      office: { ...office, nodes: [...office.nodes, node], seq: office.seq + 1 },
      owned: { ...core.owned, [deviceId]: core.owned[deviceId] - 1 },
    },
  };
};

// 自社オフィスの機器を在庫に戻す。つながるケーブルも一緒に撤去する（ケーブルは在庫を持たない）
export const removeFromOffice = (core: Core, uid: string, env: Env): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  const node = core.office.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  const removed = core.office.links.filter((l) => l.a.node === uid || l.b.node === uid);
  const nodes = core.office.nodes.filter((n) => n.uid !== uid);
  const links = core.office.links.filter((l) => !removed.includes(l));
  const segments = fillSegments({ nodes, links, segments: core.office.segments }, env.engine);
  return {
    ok: true,
    core: {
      ...core,
      office: { ...core.office, nodes, links, segments },
      owned: { ...core.owned, [node.device]: (core.owned[node.device] ?? 0) + 1 },
    },
  };
};

// 機器を撤去する（在庫に戻す）。既設の機器（node.locked）以外は、施工済みでも撤去できる。
// つながるケーブルも一緒に撤去する（ケーブルは在庫を持たず、費用も返さない）
export const removeNode = (core: Core, uid: string, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  const node = p.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.locked) return fail('locked');
  const removed = p.links.filter((l) => l.a.node === uid || l.b.node === uid);
  const removedUids = removed.map((l) => l.uid);
  const nodes = p.nodes.filter((n) => n.uid !== uid);
  const links = p.links.filter((l) => !removed.includes(l));
  const next: Project = {
    ...p,
    nodes,
    links,
    testedOk: false,
    segments: fillSegments({ nodes, links, segments: p.segments }, env.engine),
    built: {
      nodes: p.built.nodes.filter((x) => x !== uid),
      links: p.built.links.filter((x) => !removedUids.includes(x)),
    },
  };
  const owned = { ...core.owned, [node.device]: (core.owned[node.device] ?? 0) + 1 };
  return { ok: true, core: { ...withProject(core, next), owned } };
};

// 自社オフィスの編集を止めているか。自社案件を受注中は、自社オフィスの機器と配線を案件が使うため、直接編集しない
export const officeLocked = (core: Core): boolean => core.active.some((p) => p.contract.inhouse);

// 編集する対象。focus の案件（設計中）か、自社オフィス
export type NetTarget = 'focus' | 'office';

// 対象のネットワーク（機器・配線・採番・セグメントの設定）。案件・自社オフィスのどちらも同じ形で扱う
export interface Net {
  nodes: NetNode[];
  links: NetLink[];
  seq: number;
  segments: Record<string, SegmentConfig>;
}

// 対象のネットワークを取り出す。設計中の案件でない、または自社オフィスが案件に使われていれば理由を返す
export const netOf = (core: Core, target: NetTarget): Net | string => {
  if (target === 'office') {
    if (officeLocked(core)) return 'inhouse';
    const o = core.office;
    return { nodes: o.nodes, links: o.links, seq: o.seq, segments: o.segments ?? {} };
  }
  const p = requireDesign(core);
  if (typeof p === 'string') return p;
  return { nodes: p.nodes, links: p.links, seq: p.seq, segments: p.segments ?? {} };
};

// 対象のネットワークを書き戻す
export const withNet = (core: Core, target: NetTarget, net: Net): Core => {
  if (target === 'office') {
    return { ...core, office: { ...core.office, nodes: net.nodes, links: net.links, seq: net.seq, segments: net.segments } };
  }
  const p = focusedOf(core) as Project;
  // 設計を変えたので、最後のテストの結果は無効になる
  return withProject(core, { ...p, nodes: net.nodes, links: net.links, seq: net.seq, segments: net.segments, testedOk: false });
};

// 機器のポートが属するセグメント（配線がなければ undefined）
const segmentAt = (net: Net, env: Env, uid: string, port: number): Segment | undefined =>
  segmentOf(segmentsOf(net, env.engine), uid, port);

// 機器のポートのうち、ケーブルがつながっている番号の集合
const usedPorts = (links: readonly NetLink[], node: NetNode): Set<number> => {
  const used = new Set<number>();
  for (const l of links) {
    if (l.a.node === node.uid) used.add(l.a.port);
    if (l.b.node === node.uid) used.add(l.b.port);
  }
  return used;
};

// 機器の空いているポートのうち、最も小さい番号を返す
const freePort = (links: NetLink[], node: NetNode, env: Env): number | null => {
  const used = usedPorts(links, node);
  const count = env.devices[node.device].portCount;
  for (let port = 0; port < count; port++) if (!used.has(port)) return port;
  return null;
};

// 配線で使うポートの指定。省略（undefined）なら空きの最小番号を使う
export interface PortChoice {
  a?: number;
  b?: number;
}

// 機器のポートを決める。指定があればそのポートを確かめる（範囲外は port、使用中は portUsed）。指定がなければ空きの最小番号（空きがなければ port）
const choosePort = (links: NetLink[], node: NetNode, env: Env, want: number | undefined): number | string => {
  if (want === undefined) return freePort(links, node, env) ?? 'port';
  const count = env.devices[node.device].portCount;
  if (!Number.isInteger(want) || want < 0 || want >= count) return 'port';
  return usedPorts(links, node).has(want) ? 'portUsed' : want;
};

// 2台の機器を配線できるか判定する。できなければ理由を返す（配線中の表示と配線の実行で使う）。ports を省略すると空きのポートを使う
export const checkConnect = (
  core: Core,
  aUid: string,
  bUid: string,
  cableId: string,
  env: Env,
  target: NetTarget = 'focus',
  ports: PortChoice = {},
): string | null => {
  const net = netOf(core, target);
  if (typeof net === 'string') return net;
  const a = net.nodes.find((n) => n.uid === aUid);
  const b = net.nodes.find((n) => n.uid === bUid);
  const cable = env.cables[cableId];
  if (!a || !b || aUid === bUid || !cable) return 'none';
  const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const lengthCheck = checkCableLength(length, cable.maxLengthTiles);
  if (lengthCheck !== 'ok') return lengthCheck;
  if (core.clock.money < paidCable(core, cable.pricePerLink + cable.pricePerTile * length)) return 'money';
  const portA = choosePort(net.links, a, env, ports.a);
  if (typeof portA === 'string') return portA;
  const portB = choosePort(net.links, b, env, ports.b);
  if (typeof portB === 'string') return portB;
  return null;
};

// 空いているポートの数（描画で使う）
export const freePortCount = (p: Project, node: NetNode, env: Env): number => {
  const used = new Set<number>();
  for (const l of p.links) {
    if (l.a.node === node.uid) used.add(l.a.port);
    if (l.b.node === node.uid) used.add(l.b.port);
  }
  return env.devices[node.device].portCount - used.size;
};

// ケーブル1本の費用（配線の長さで決まる）
const cableCost = (cable: Env['cables'][string], length: number): number => cable.pricePerLink + cable.pricePerTile * length;

// 2台の機器を配線する。ケーブル費用は配線の長さで決まる。ポートの指定がなければ空いているポートを順に使う。
// 自社オフィスへの配線は施工を待たずに反映する。案件への配線は案件の費用に加える
export const connect = (
  core: Core,
  aUid: string,
  bUid: string,
  cableId: string,
  env: Env,
  target: NetTarget = 'focus',
  ports: PortChoice = {},
): Outcome => {
  const reason = checkConnect(core, aUid, bUid, cableId, env, target, ports);
  if (reason) return fail(reason);
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const a = net.nodes.find((n) => n.uid === aUid);
  const b = net.nodes.find((n) => n.uid === bUid);
  // 機器が見つからないのは、画面と状態のずれ。黙って進めず、理由を返す
  if (!a || !b) return fail('none');
  const cable = env.cables[cableId];
  const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const listCost = cableCost(cable, length);
  const cost = paidCable(core, listCost);
  const chosenA = choosePort(net.links, a, env, ports.a);
  const chosenB = choosePort(net.links, b, env, ports.b);
  if (typeof chosenA === 'string') return fail(chosenA);
  if (typeof chosenB === 'string') return fail(chosenB);
  const portA = chosenA;
  const portB = chosenB;
  const link: NetLink = {
    uid: `l${net.seq}`,
    cable: cableId,
    a: { node: a.uid, port: portA },
    b: { node: b.uid, port: portB },
    // 折れ点を1つ入れたL字の配線
    path: [
      [a.x, a.y],
      [b.x, a.y],
      [b.x, b.y],
    ],
  };
  const links = [...net.links, link];
  const segments = fillSegments({ nodes: net.nodes, links, segments: net.segments }, env.engine);
  let next = withNet(core, target, { nodes: net.nodes, links, seq: net.seq + 1, segments });
  if (target === 'focus') {
    const p = focusedOf(next) as Project;
    next = withProject(next, { ...p, cost: p.cost + cost });
  }
  // 割引で浮いた額は、節約として帳簿に残す（資金は変えない）
  return { ok: true, core: { ...next, clock: recordSaving(applyMoney(next.clock, -cost, 'construction'), listCost - cost) } };
};

// 配線を撤去する。ケーブルは在庫を持たないため戻さない。案件では、施工前の配線の費用を案件と所持金に戻す（施工済みは戻さない）。
// 案件の既設の配線（自社案件の引き継ぎ分）は撤去できない
export const removeLink = (core: Core, uid: string, target: NetTarget, env: Env): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const link = net.links.find((l) => l.uid === uid);
  if (!link) return fail('none');
  let refund = 0;
  if (target === 'focus') {
    const p = focusedOf(core) as Project;
    if ((p.inheritedLinks ?? []).includes(uid)) return fail('locked');
    const a = net.nodes.find((n) => n.uid === link.a.node);
    const b = net.nodes.find((n) => n.uid === link.b.node);
    const cable = env.cables[link.cable];
    if (!p.built.links.includes(uid) && a && b && cable) {
      refund = paidCable(core, cableCost(cable, Math.abs(a.x - b.x) + Math.abs(a.y - b.y)));
    }
  }
  const links = net.links.filter((l) => l.uid !== uid);
  let next = withNet(core, target, { ...net, links, segments: fillSegments({ nodes: net.nodes, links, segments: net.segments }, env.engine) });
  if (target === 'focus') {
    const p = focusedOf(next) as Project;
    next = withProject(next, { ...p, cost: p.cost - refund, built: { ...p.built, links: p.built.links.filter((x) => x !== uid) } });
  }
  return {
    ok: true,
    core: {
      ...next,
      clock: applyMoney(next.clock, refund, 'construction'),
    },
  };
};

// 機器の設定を書き換える。配線の設定が固定された機器は変えられない。
const editNode = (core: Core, uid: string, edit: (n: NetNode) => NetNode | string, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.configLocked) return fail('locked');
  const result = edit(node);
  if (typeof result === 'string') return fail(result);
  return { ok: true, core: withNet(core, target, { ...net, nodes: net.nodes.map((n) => (n.uid === uid ? result : n)) }) };
};

// 機器の名前を付け直す。名前は見た目だけなので、設定が固定された機器でも変えられる。空なら既定の名前に戻す
// ホスト名を付ける（null で外す）。画面の名前（setName）とは別に持つ（N46）
export const setHostname = (core: Core, uid: string, hostname: string | null, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, hostname: hostname ?? undefined }), target);

// ネームサーバー（ip name-server）を設定する。null で外す（N68）
export const setNameServer = (core: Core, uid: string, ip: string | null, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, nameServer: ip ?? undefined }), target);

// DNS の役割を付ける（zone は空から）。外すと表も消える（N68）
export const setDnsRole = (core: Core, uid: string, on: boolean, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, dns: on ? (node.dns ?? { zone: [] }) : undefined }), target);

// 名前と IPアドレスの表を、同じ案件（自社オフィス）の機器から作る。ホスト名のある機器の、最初の IPアドレスを登録する（N68）
export const zoneFromNodes = (nodes: readonly NetNode[]): HostEntry[] =>
  nodes.flatMap((n) => (n.hostname && n.interfaces[0] ? [{ name: n.hostname, ip: n.interfaces[0].ip }] : []));

// 同じホスト名が2つ以上ある名前の一覧（DNS の自動登録の警告に使う）
export const duplicateHostnames = (nodes: readonly NetNode[]): string[] => {
  const count = new Map<string, number>();
  for (const n of nodes) if (n.hostname) count.set(n.hostname, (count.get(n.hostname) ?? 0) + 1);
  return [...count].filter(([, c]) => c > 1).map(([name]) => name);
};

// 「自動で登録する」: 対象のネットワークの機器から DNS の表を作り直す（DNS の役割のある機器だけ）
export const autoRegisterZone = (core: Core, uid: string, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const zone = zoneFromNodes(net.nodes);
  return editNode(core, uid, (node) => (node.dns ? { ...node, dns: { zone } } : 'none'), target);
};

export const setName = (core: Core, uid: string, name: string, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  const renamed = renameNode(node, name);
  if ((renamed.name ?? '') === (node.name ?? '')) return { ok: true, core };
  return { ok: true, core: withNet(core, target, { ...net, nodes: net.nodes.map((n) => (n.uid === uid ? renamed : n)) }) };
};

// 対応表に名前と IPアドレスを登録する（同じ名前があれば入れ替える）。名前は機器の中だけで有効
export const setHost = (core: Core, uid: string, name: string, ip: string, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, hosts: [...(node.hosts ?? []).filter((h) => h.name !== name), { name, ip }] }), target);

// 対応表から名前を消す。なければ none
export const removeHost = (core: Core, uid: string, name: string, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => ((node.hosts ?? []).some((h) => h.name === name) ? { ...node, hosts: (node.hosts ?? []).filter((h) => h.name !== name) } : 'none'),
    target,
  );

// IPアドレスの書式（各区切りは 0〜255）
const isIp = (s: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255);
// 「a.b.c.d/nn」（ネットワークの指定）
const isCidr = (s: string): boolean => {
  const [ip, prefix] = s.split('/');
  return prefix !== undefined && isIp(ip) && /^\d{1,2}$/.test(prefix) && Number(prefix) <= 32;
};

// ポートのIPアドレスを設定する。ip が空文字なら設定を外す（機器の IP は未設定に戻る）。
// そのポートのセグメントに設定がなければ、入力したアドレスのネットワークを設定にする（配線の後に入力した場合など）
export const setInterface = (
  core: Core,
  uid: string,
  port: number,
  ip: string,
  prefix: number,
  env: Env,
  target: NetTarget = 'focus',
): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.configLocked) return fail('locked');
  if (ip !== '' && !isIp(ip)) return fail('ip');
  const interfaces: Iface[] =
    ip === ''
      ? node.interfaces.filter((i) => i.port !== port)
      : [...node.interfaces.filter((i) => i.port !== port), { port, ip, prefix }];
  const nodes = net.nodes.map((n) => (n.uid === uid ? { ...node, interfaces } : n));
  const segments = fillSegments({ nodes, links: net.links, segments: net.segments }, env.engine);
  return { ok: true, core: withNet(core, target, { ...net, nodes, segments }) };
};

// デフォルトゲートウェイを設定する。null で外す
export const setGateway = (core: Core, uid: string, gateway: string | null, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (gateway !== null && !isIp(gateway)) return 'ip';
      return { ...node, gateway };
    },
    target,
  );

// ファイアウォールの規則を置き換える（N38）。規則の送信元・宛先は 'any' か「a.b.c.d/nn」。一覧にない通信は通さない
export const setFirewallRules = (core: Core, uid: string, rules: FirewallRule[], target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      for (const r of rules) {
        if (r.src !== 'any' && !isCidr(r.src)) return 'ip';
        if (r.dst !== 'any' && !isCidr(r.dst)) return 'ip';
      }
      return { ...node, rules };
    },
    target,
  );

// ルーターに静的ルートを追加する
export const addRoute = (core: Core, uid: string, route: Route, target: NetTarget = 'focus'): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      if (!isIp(route.dest) || !isIp(route.nextHop)) return 'ip';
      return { ...node, routes: [...node.routes, route] };
    },
    target,
  );

// ルーターの静的ルートを削除する
export const removeRoute = (core: Core, uid: string, index: number, target: NetTarget = 'focus'): Outcome =>
  editNode(core, uid, (node) => ({ ...node, routes: node.routes.filter((_, i) => i !== index) }), target);

// 配線の片方の端（a か b）を、同じ機器の別のポートへ挿し替える。埋まったポートには挿せない。
// ケーブルの長さは変わらないため費用は変えない。ポートのIPアドレスは、ポートの番号に付いたまま残す。
export type End = 'a' | 'b';
export const replug = (core: Core, linkUid: string, end: End, port: number, env: Env, target: NetTarget = 'focus'): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const link = net.links.find((l) => l.uid === linkUid);
  if (!link) return fail('none');
  if (target === 'focus' && (focusedOf(core)?.inheritedLinks ?? []).includes(linkUid)) return fail('locked');
  const endpoint = end === 'a' ? link.a : link.b;
  const node = net.nodes.find((n) => n.uid === endpoint.node);
  if (!node) return fail('none');
  const count = env.devices[node.device]?.portCount ?? 0;
  if (!Number.isInteger(port) || port < 0 || port >= count) return fail('port');
  if (port === endpoint.port) return fail('portUsed');
  const used = net.links.some(
    (l) => l.uid !== linkUid && ((l.a.node === node.uid && l.a.port === port) || (l.b.node === node.uid && l.b.port === port)),
  );
  if (used) return fail('portUsed');
  const moved: NetLink = { ...link, [end]: { node: node.uid, port } };
  const links = net.links.map((l) => (l.uid === linkUid ? moved : l));
  const segments = fillSegments({ nodes: net.nodes, links, segments: net.segments }, env.engine);
  return { ok: true, core: withNet(core, target, { ...net, links, segments }) };
};

// 2つの機器の位置をつなぐ配線の経路（折れ点を1つ入れたL字。connect と同じ形）
const cablePath = (a: NetNode, b: NetNode): NetLink['path'] => [
  [a.x, a.y],
  [b.x, a.y],
  [b.x, b.y],
];

// 配線の費用を払う（正）か返す（負）。案件では案件の費用も増減する。自社オフィスの費用は案件の費用に入れない
// delta は定価の増減。払う額は割引のあとで、増えたときだけ割引が効く。浮いた額は節約に残す
const payCable = (core: Core, target: NetTarget, delta: number): Core => {
  const paid = delta > 0 ? paidCable(core, delta) : delta;
  const saved = delta > 0 ? delta - paid : 0;
  const next = { ...core, clock: recordSaving(applyMoney(core.clock, -paid, 'construction'), saved) };
  if (target !== 'focus') return next;
  const p = focusedOf(next) as Project;
  return withProject(next, { ...p, cost: p.cost + paid });
};

// 機器を別のマスへ動かす。置ける条件は配置と同じ（自社オフィスの規則、または床）。
// つながるケーブルは新しい位置に合わせて経路と長さを引き直し、費用の差額を払う（返す）。
// 施工済みの機器を動かすと、その機器とつながるケーブルは施工前に戻る。既設（locked）の機器と、既設のケーブルにつながる機器は動かせない
export const moveNode = (core: Core, uid: string, x: number, y: number, env: Env, target: NetTarget, map: GameMap, anyFloor = false): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const node = net.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  const project = target === 'focus' ? (focusedOf(core) as Project) : null;
  const attached = net.links.filter((l) => l.a.node === uid || l.b.node === uid);
  if (node.locked || attached.some((l) => (project?.inheritedLinks ?? []).includes(l.uid))) return fail('locked');
  if (x === node.x && y === node.y) return { ok: true, core };
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  const inhouse = project === null || project.contract.inhouse;
  const others = net.nodes.filter((n) => n.uid !== uid);
  const furniture = inhouse ? core.office.furniture : furnitureOf(map.furniture, project?.contract.furniture);
  const reason = placeReason(inhouse, furniture, others, node.device, x, y, map, env, anyFloor);
  if (reason) return fail(reason);

  const nodes = net.nodes.map((n) => (n.uid === uid ? { ...node, x, y } : n));
  const after = new Map(nodes.map((n) => [n.uid, n] as const));
  const before = new Map(net.nodes.map((n) => [n.uid, n] as const));
  let delta = 0;
  const links: NetLink[] = [];
  for (const l of net.links) {
    if (l.a.node !== uid && l.b.node !== uid) {
      links.push(l);
      continue;
    }
    const cable = env.cables[l.cable];
    const a = after.get(l.a.node)!;
    const b = after.get(l.b.node)!;
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    if (!cable) return fail('cable');
    const lengthCheck = checkCableLength(length, cable.maxLengthTiles);
    if (lengthCheck !== 'ok') return fail(lengthCheck);
    const oldA = before.get(l.a.node)!;
    const oldB = before.get(l.b.node)!;
    const oldLength = Math.abs(oldA.x - oldB.x) + Math.abs(oldA.y - oldB.y);
    delta += cableCost(cable, length) - cableCost(cable, oldLength);
    links.push({ ...l, path: cablePath(a, b) });
  }
  if (delta > 0 && core.clock.money < paidCable(core, delta)) return fail('money');

  const segments = fillSegments({ nodes, links, segments: net.segments }, env.engine);
  let next = withNet(core, target, { nodes, links, seq: net.seq, segments });
  if (project) {
    // 動かした機器とつながるケーブルは、施工前に戻す
    const p = focusedOf(next) as Project;
    const attachedUids = attached.map((l) => l.uid);
    next = withProject(next, {
      ...p,
      built: {
        nodes: p.built.nodes.filter((x) => x !== uid),
        links: p.built.links.filter((x) => !attachedUids.includes(x)),
      },
    });
  }
  return { ok: true, core: payCable(next, target, delta) };
};

// 配線の片方の端（end）を、ほかの機器（nodeUid）の空いているポートへ挿し替える。相手の機器を変えられる。
// port が null なら、相手の機器の空いている最小の番号を使う。空きがなければ失敗する（port。番号を指定して埋まっていれば portUsed）。
// ケーブルは新しい長さで経路と費用を引き直し、差額を払う（返す）。挿し替えたケーブルは施工前に戻す。既設のケーブルは挿し替えられない
export const replugTo = (
  core: Core,
  linkUid: string,
  end: End,
  nodeUid: string,
  port: number | null,
  env: Env,
  target: NetTarget = 'focus',
): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const link = net.links.find((l) => l.uid === linkUid);
  if (!link) return fail('none');
  const project = target === 'focus' ? (focusedOf(core) as Project) : null;
  if ((project?.inheritedLinks ?? []).includes(linkUid)) return fail('locked');
  const endpoint = end === 'a' ? link.a : link.b;
  const other = end === 'a' ? link.b : link.a;
  const node = net.nodes.find((n) => n.uid === nodeUid);
  if (!node || nodeUid === other.node) return fail('none');
  const count = env.devices[node.device]?.portCount ?? 0;
  // 相手の機器のポートが埋まっているか（同じ機器なら、この端が今つないでいるポートも埋まっている）
  const taken = (p: number): boolean =>
    (nodeUid === endpoint.node && p === endpoint.port) ||
    net.links.some(
      (l) => l.uid !== linkUid && ((l.a.node === nodeUid && l.a.port === p) || (l.b.node === nodeUid && l.b.port === p)),
    );
  let to: number;
  if (port === null) {
    let free: number | undefined;
    for (let p = 0; p < count && free === undefined; p++) if (!taken(p)) free = p;
    if (free === undefined) return fail('port');
    to = free;
  } else {
    if (!Number.isInteger(port) || port < 0 || port >= count) return fail('port');
    if (taken(port)) return fail('portUsed');
    to = port;
  }

  const before = new Map(net.nodes.map((n) => [n.uid, n] as const));
  const a = end === 'a' ? node : before.get(link.a.node)!;
  const b = end === 'b' ? node : before.get(link.b.node)!;
  const cable = env.cables[link.cable];
  const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  if (!cable) return fail('cable');
  const lengthCheck = checkCableLength(length, cable.maxLengthTiles);
  if (lengthCheck !== 'ok') return fail(lengthCheck);
  const oldA = before.get(link.a.node)!;
  const oldB = before.get(link.b.node)!;
  const delta = cableCost(cable, length) - cableCost(cable, Math.abs(oldA.x - oldB.x) + Math.abs(oldA.y - oldB.y));
  if (delta > 0 && core.clock.money < paidCable(core, delta)) return fail('money');

  const moved: NetLink = { ...link, [end]: { node: nodeUid, port: to }, path: cablePath(a, b) };
  const links = net.links.map((l) => (l.uid === linkUid ? moved : l));
  const segments = fillSegments({ nodes: net.nodes, links, segments: net.segments }, env.engine);
  let next = withNet(core, target, { ...net, links, segments });
  if (project) {
    // 挿し替えたケーブルは、施工前に戻す
    const p = focusedOf(next) as Project;
    next = withProject(next, { ...p, built: { ...p.built, links: p.built.links.filter((x) => x !== linkUid) } });
  }
  return { ok: true, core: payCable(next, target, delta) };
};

// サービスの既定の待ち受けポート（プロトコルごと）。起動するときに使う
const DEFAULT_SERVICE_PORT: Record<Service['protocol'], number> = { http: 80 };

// サービスを起動する（on）または停止する（off）。配線の設定が固定された機器は変えられない
export const setService = (
  core: Core,
  uid: string,
  protocol: Service['protocol'],
  on: boolean,
  target: NetTarget = 'focus',
): Outcome =>
  editNode(
    core,
    uid,
    (node) => {
      const others = node.services.filter((s) => s.protocol !== protocol);
      if (!on) return { ...node, services: others };
      const current = node.services.find((s) => s.protocol === protocol);
      return { ...node, services: [...others, current ?? { protocol, port: DEFAULT_SERVICE_PORT[protocol] }] };
    },
    target,
  );

// セグメントのネットワークを設定する。設定だけを行い、機器のアドレスは変えない（未設定のアドレスは IPアドレスの自動割り当て autoAssign が振る）。
// 案件で設定が固定された機器を含むセグメントは変えられない。
// 対象は、機器のポートが属するセグメント（配線がなければ none）
export const setSegment = (
  core: Core,
  uid: string,
  port: number,
  network: string,
  prefix: number,
  env: Env,
  target: NetTarget = 'focus',
): Outcome => {
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const seg = segmentAt(net, env, uid, port);
  if (!seg) return fail('none');
  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  if (seg.members.some((m) => byUid.get(m.node)?.configLocked)) return fail('locked');
  if (!isIp(network) || prefix < PREFIX_MIN || prefix > PREFIX_MAX || networkAddress(network, prefix) !== network) return fail('ip');
  if (seg.members.length > hostCapacity(prefix)) return fail('segment.too_small');
  const segments = { ...net.segments, [seg.key]: { network, prefix } };
  return { ok: true, core: withNet(core, target, { ...net, segments }) };
};

// アドレスの候補（セグメントで使えるアドレスの一覧）。使用中のアドレスには、使っている機器とポートを付ける
export interface AddressCandidate {
  ip: string;
  usedBy: { node: string; port: number } | null;
}

// ネットワーク（先頭アドレスと prefix）で使えるアドレスの一覧。ネットワークアドレスとブロードキャストアドレスを除き、.1 から順に並べる。
// 設定の前でも後でも同じ範囲・同じ順になる。使用中のアドレスには、使っている機器とポートを付ける（同じネットワーク内のすべての機器を見る）
const addressRange = (
  network: string,
  prefix: number,
  nodes: Array<{ uid: string; interfaces: Array<{ port: number; ip: string }> }>,
): AddressCandidate[] => {
  const base = ipToInt(network);
  const size = 2 ** (32 - prefix);
  const owners = new Map<number, { node: string; port: number }>();
  for (const n of nodes) for (const i of n.interfaces) owners.set(ipToInt(i.ip), { node: n.uid, port: i.port });
  const list: AddressCandidate[] = [];
  for (let h = 1; h <= size - 2; h++) list.push({ ip: intToIp(base + h), usedBy: owners.get(base + h) ?? null });
  return list;
};

// 機器のポートのセグメントで使えるアドレスの一覧（addressRange と同じ）。
// セグメントに設定がなければ空の一覧
export const addressCandidates = (core: Core, uid: string, port: number, env: Env, target: NetTarget = 'focus'): AddressCandidate[] => {
  const net = netOf(core, target);
  if (typeof net === 'string') return [];
  const seg = segmentAt(net, env, uid, port);
  if (!seg) return [];
  const cfg = segmentConfigOf(seg, new Map(net.nodes.map((n) => [n.uid, n])), net.segments);
  if (!cfg) return [];
  return addressRange(cfg.network, cfg.prefix, net.nodes);
};

// まだ配線していない機器（PC・サーバー）にIPアドレスを設定するときの既定のネットワーク。配線すると、入力したアドレスの /24 がセグメントの設定になる
export const PLANNED_NETWORK = '192.168.1.0';
export const PLANNED_PREFIX = 24;

// 配線の前に設定するときのアドレスの候補。ネットワークに設定がなくても、指定したネットワークで addressCandidates と同じ範囲・同じ順になる（.1 から）。
// 使用中のアドレスには、使っている機器とポートを付ける（同じ案件のほかの機器が使っている物も含む）
export const plannedAddressCandidates = (core: Core, network: string, prefix: number, target: NetTarget = 'focus'): AddressCandidate[] => {
  const net = netOf(core, target);
  if (typeof net === 'string') return [];
  return addressRange(network, prefix, net.nodes);
};

// 色と配線から生成したネットワーク（判定・表示に使う）→ 配線とセグメントの設定から生成したネットワーク
export const compiledNet = (p: Project, env: Env) => compile({ nodes: p.nodes, links: p.links, segments: p.segments }, env.engine);

// 設計時点の不備（機器の uid -> 不備の内容）
export const designIssues = (p: Project, env: Env): Record<string, IssueDetail> => compiledNet(p, env).issues;

// 施工を依頼する。施工時間は、まだ施工していない機器と配線の分だけかかる。テストに合格していなければ依頼できない（untested）。
export const requestBuild = (core: Core, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  if (!p.testedOk) return fail('untested');
  const newNodes = p.nodes.filter((n) => !p.built.nodes.includes(n.uid));
  const newLinks = p.links.filter((l) => !p.built.links.includes(l.uid));
  const total =
    newNodes.length * env.balance.build.minutesPerDevice +
    newLinks.reduce((sum, l) => sum + linkLength(l.path) * env.balance.build.minutesPerCableTile, 0);
  return { ok: true, core: withProject(core, { ...p, phase: 'build', progress: 0, total }) };
};

// 施工を1Tick分進める。勤務時間内のみ、担当の社員が並行して作業する。施工中の案件をすべて進め、終わった案件は検収する。
// 検収の結果が出たら止める（残りの案件は次のTickで進める）
// juniorRate は人事の効果（新人の施工の経験値の倍率。既定は1）
export const advanceBuild = (core: Core, env: Env, hour: number, juniorRate = 1): Outcome => {
  // 施工は、その時刻に勤務中の担当の社員だけが進める（日勤と夜勤は区分ごと。N48）
  const minute = hour * 60;
  const onShiftNow = (s: Staff) => isOnShift(minute, s.shift, env.balance);
  const bonusEnv: BonusEnv = { defs: env.furniture ?? {}, balance: env.balance, staff: core.staff };
  const crewOf = (p: Project) => core.staff.filter((s) => p.crew.includes(s.uid));
  // 施工中の案件の担当は、勤務中に1ゲーム時間ぶんの経験値を得る（着席の社員は家具の補正を受ける）
  let state: Core = core;
  const building = new Set(core.active.filter((p) => p.phase === 'build').flatMap((p) => p.crew));
  if (building.size > 0) {
    const hours = env.balance.time.gameMinutesPerTick / 60;
    state = {
      ...core,
      staff: core.staff.map((s) =>
        building.has(s.uid) && onShiftNow(s)
          ? gainExp(
              s,
              hours * (1 + furnitureBonus(core.office, s.uid, bonusEnv).exp) * (s.level <= env.balance.backOffice.hr.juniorMaxLevel ? juniorRate : 1),
              env.balance.staff.expPerLevel,
            )
          : s,
      ),
    };
  }
  // 全案件の進みを反映してから検収する（1つの案件を検収しても、同じTickのほかの案件の進みを捨てない）
  let finished: string | null = null;
  for (const p of core.active) {
    if (p.phase !== 'build') continue;
    // 施工の進みは、担当の社員の施工力の合計に比例する。案件の向いている職種の社員は1.5倍
    const jobs = p.contract.jobs ?? [];
    const power = crewOf(p).filter(onShiftNow).reduce((sum, s) => sum + staffPower(s, jobs, core.office, bonusEnv), 0);
    let progress = p.progress;
    progress += env.balance.time.gameMinutesPerTick * power * (1 + core.effects.buildSpeed);
    if (progress < p.total) {
      state = withProject(state, { ...p, progress });
      continue;
    }
    const built = {
      nodes: p.nodes.map((n) => n.uid),
      links: p.links.map((l) => l.uid),
    };
    state = withProject(state, { ...p, progress, built });
    finished ??= p.id;
  }
  // 検収の結果が出たら止める（残りの施工を終えた案件は次のTickで検収する）。型紙なしで任せた依頼は、受注のときの結果で納品する
  if (finished !== null) {
    const done = state.active.find((x) => x.id === finished);
    if (done?.blind) return settleBlind(state, done, done.blind, env);
    return inspect(state, env, finished);
  }
  return { ok: true, core: state };
};

// 設計を判定する（テストと検収で同じ判定を使う）。達成条件ごとに、失敗した機器と理由をまとめる
const judge = (p: Project, env: Env) => {
  const result = evaluateContract(p.contract, compiledNet(p, env).net, env.engine);
  const traces: Trace[] = result.results.map((r) => ({ kind: r.kind, src: r.src, dst: r.dst, result: r.result }));
  const goals: GoalCheck[] = p.contract.goals.map((goal) => {
    const rs = result.results.filter((r) => r.goal === goal);
    const seen = new Set<string>();
    const failures: GoalCheck['failures'] = [];
    for (const r of rs) {
      if (r.ok || !r.failure) continue;
      const key = `${r.failure.node}:${r.failure.reason}`;
      if (seen.has(key)) continue;
      seen.add(key);
      failures.push({ node: r.failure.node, reason: r.failure.reason });
    }
    return { ok: rs.length > 0 && rs.every((r) => r.ok), failures };
  });
  return { passed: result.passed, results: result.results, traces, goals };
};

export type TestOutcome = { ok: true; core: Core; result: TestResult } | { ok: false; reason: string };

// テストを押す。設計を判定し、合格なら施工を依頼できるようにする（testedOk）。時間も費用もかからない。何度でも押せる
export const testDesign = (core: Core, env: Env): TestOutcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return { ok: false, reason: p };
  const j = judge(p, env);
  const result: TestResult = { passed: j.passed, goals: j.goals, traces: j.traces };
  return { ok: true, core: withProject(core, { ...p, testedOk: j.passed }), result };
};

// 型紙なしで任せる（N94）。設計は作らず、結果を乱数で決める。費用は予算 × 費用の割合を払い、報酬は★の倍率で決まる。
// 経験値は半分。設計は地図に残さない（結果画面は★・費用・報酬）
// 受注して施工に入る。結果（★・費用の割合・手直し）は受注のときに乱数で決めて案件に持たせ、施工が終わったら納品する（settleBlind）
export type BlindOutcome = { ok: true; core: Core; rng: number } | { ok: false; reason: string };

export const delegateBlind = (core: Core, offerId: string, crew: string[], env: Env, rng: number, slots: number): BlindOutcome => {
  const offer = core.offers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: 'none' };
  const contract = offer.contract;
  if (contract.inhouse) return { ok: false, reason: 'inhouse' };
  const key = familiarKeyOf(offer.kind, offer.baseId, contract.map);
  if ((core.familiarity.counts[key] ?? 0) < DELEGATE_MIN_COUNT) return { ok: false, reason: 'delegate.count' };
  // 型紙が写せるなら、型紙で任せる（こちらは使わない）
  const bp = core.familiarity.blueprints[key];
  if (bp && positionsMatch(bp.design, fixedNodes(contract))) return { ok: false, reason: 'delegate.blueprint_fits' };
  // 担当・枠・内勤の判定は受注と同じ（accept）
  const accepted = accept(core, offerId, slots, crew);
  if (!accepted.ok) return { ok: false, reason: accepted.reason };
  const crewMembers = crew.map((uid) => core.staff.find((s) => s.uid === uid)) as Staff[];
  const bonusEnv: BonusEnv = { defs: env.furniture ?? {}, balance: env.balance, staff: core.staff };
  const jobs = contract.jobs ?? [];
  const power = crewMembers.reduce((sum, m) => sum + staffPower(m, jobs, core.office, bonusEnv), 0);
  const pcCount = contract.placed.filter((p) => env.devices[p.device]?.category === 'pc').length;
  const match = jobs.length === 0 ? 1 : crewMembers.filter((m) => jobs.includes(m.job)).length / crewMembers.length;
  const result = blindDelegation(power, pcCount, match, env.balance, rng);
  const plan: BlindPlan = { stars: result.stars, costRatio: result.costRatio, rework: result.rework };
  // 施工の時間は、配置する機器の数で決める。進みは担当の社員の施工力に比例する（advanceBuild）
  const total = Math.max(1, contract.placed.length) * env.balance.delegate.blindMinutesPerDevice;
  const project = accepted.core.active.find((x) => x.id === offerId);
  if (!project) return { ok: false, reason: 'none' };
  const started: Project = { ...project, delegated: true, blind: plan, phase: 'build', progress: 0, total, testedOk: true };
  return { ok: true, core: withProject(accepted.core, started), rng: result.rng };
};

// 型紙なしで任せた依頼を納品する。費用は予算 × 費用の割合、報酬は★の倍率で決まる。経験値は半分。設計は地図に残さない
const settleBlind = (core: Core, p: Project, plan: BlindPlan, env: Env): Outcome => {
  const contract = p.contract;
  const { stars, costRatio, rework } = plan;
  const cost = Math.round(contract.budget * costRatio);
  const money = Math.round(contract.reward.money * rewardRateOf(stars, env.balance));
  const fullExp = deliveryExpOf(contract.unlockLevel, levelOf(core.companyExp, env.balance), rewardRateOf(stars, env.balance), env.balance);
  const expGain = Math.max(1, Math.floor(fullExp / DELEGATED_EXP_DIVISOR));
  let clock = applyMoney(core.clock, -cost, 'construction');
  clock = applyMoney(clock, money, 'reward');
  // 報酬の機器はインベントリに入る（型紙で任せた依頼と同じ）
  const owned = { ...core.owned };
  for (const r of contract.reward.devices ?? []) owned[r.device] = (owned[r.device] ?? 0) + r.count;
  return {
    ok: true,
    core: {
      ...core,
      ...removeProject(core, p.id),
      clock,
      owned,
      completed: p.kind === 'fixed' ? [...core.completed, p.baseId] : core.completed,
      deliveries: core.deliveries + 1,
      companyExp: core.companyExp + expGain,
      reputation: core.reputation + stars,
    },
    report: {
      passed: true,
      traces: [],
      failures: [],
      stars,
      money,
      cost,
      budget: contract.budget,
      rework,
      lateDays: 0,
      designIssues: 0,
      expGain,
      rewardDevices: contract.reward.devices ?? [],
      delegated: true,
    },
  };
};

// 検収: 達成条件を判定する。合格なら納品して報酬と評判を得る。不合格なら設計に戻す（テストの結果を画面に残す）。
export const inspect = (core: Core, env: Env, id: string): Outcome => {
  const p = core.active.find((x) => x.id === id);
  if (!p) return fail('none');
  const j = judge(p, env);
  const traces = j.traces;
  if (j.passed) {
    // 期日に遅れたら、遅れた日数に応じて報酬が減る。遅れた案件と設計の不備がある案件は、★は2が上限になる
    const lateDays = lateDaysOf(p.due, core.clock.minute);
    const issues = Object.keys(designIssues(p, env)).length;
    const cost = projectCostOf(p, env);
    const rawStars = rate(cost.total, p.contract.budget, p.rework, lateDays > 0, issues, env.balance);
    // 任せた依頼は★の上限が2（N70）
    const stars = (p.delegated ? Math.min(DELEGATED_STAR_CAP, rawStars) : rawStars) as typeof rawStars;
    // 報酬は、期日の割合と★ごとの倍率を掛けた額
    const money = Math.round(p.contract.reward.money * lateFactor(lateDays, env.balance) * rewardRateOf(stars, env.balance));
    // 会社の経験値は、現在のレベルの必要経験値に割合と★の倍率を掛けた量で増える（deliveryExpOf）。評判は得た★の数だけ増える（N55）
    const expGain = deliveryExpOf(p.contract.unlockLevel, levelOf(core.companyExp, env.balance), rewardRateOf(stars, env.balance), env.balance);
    // 任せた依頼は経験値を半分にする（N70）
    const companyExp = core.companyExp + (p.delegated ? Math.max(1, Math.floor(expGain / DELEGATED_EXP_DIVISOR)) : expGain);
    const reputation = core.reputation + stars;
    // 自社案件は、納品したネットワークを自社オフィスとして残し、効果を加える
    const office: Office = p.contract.inhouse
      ? { ...core.office, nodes: p.nodes, links: p.links, seq: p.seq, segments: p.segments ?? {} }
      : core.office;
    const effects = { buildSpeed: core.effects.buildSpeed + (p.contract.effect?.buildSpeed ?? 0) };
    // 報酬の機器はインベントリに入る（自社案件の報酬）
    const owned = { ...core.owned };
    for (const r of p.contract.reward.devices ?? []) owned[r.device] = (owned[r.device] ?? 0) + r.count;
    return {
      ok: true,
      core: {
        ...core,
        ...removeProject(core, p.id),
        office,
        effects,
        owned,
        clock: applyMoney(core.clock, money, 'reward'),
        companyExp,
        reputation,
        completed: p.kind === 'fixed' ? [...core.completed, p.baseId] : core.completed,
        // なじみの依頼: ★2以上の納品を数え、設計を型紙として覚える（自社案件は対象外）（N70）
        familiarity: p.contract.inhouse ? core.familiarity : recordDelivery(core.familiarity, familiarKeyOf(p.kind, p.baseId, p.contract.map), stars, { nodes: p.nodes, links: p.links, segments: p.segments ?? {} }),
        deliveries: core.deliveries + 1,
      },
      report: {
        passed: true,
        delivered: p,
        traces,
        stars,
        money,
        lateDays,
        cost: cost.total,
        costBreakdown: cost,
        rewardDevices: p.contract.reward.devices ?? [],
        delegated: p.delegated,
        budget: p.contract.budget,
        rework: p.rework,
        designIssues: issues,
        expGain: companyExp - core.companyExp,
        failures: [],
      },
    };
  }
  const failures: ReportFailure[] = j.results
    .filter((r) => !r.ok && r.failure)
    .map((r) => ({ reason: r.failure!.reason, node: r.failure!.node, goal: r.goal.type }));
  const next: Project = { ...p, rework: p.rework + 1, phase: 'design', progress: 0, total: 0, testedOk: false };
  return {
    ok: true,
    core: withProject(core, next),
    report: { passed: false, traces, failures, check: { projectId: p.id, goals: j.goals } },
  };
};

// 受注中の案件を取り消す（施工前のみ）。配置した機器は在庫に戻す。
export const abandon = (core: Core): Outcome => {
  const p = focusedOf(core);
  if (!p) return fail('none');
  const inherited = new Set(p.inherited ?? []);
  const builtNew = p.built.nodes.filter((uid) => !inherited.has(uid));
  if (p.phase !== 'design' || builtNew.length > p.contract.placed.length) return fail('locked');
  const owned = { ...core.owned };
  for (const n of p.nodes) if (!n.locked && !inherited.has(n.uid)) owned[n.device] = (owned[n.device] ?? 0) + 1;
  // 固定案件は、やめても依頼の一覧に戻す（定型案件は今までどおり消える）
  const back = p.kind === 'fixed' && !core.offers.some((o) => o.baseId === p.baseId);
  const offers: Offer[] = back
    ? [...core.offers, { id: p.baseId, kind: 'fixed', baseId: p.baseId, params: p.params, contract: p.contract }]
    : core.offers;
  return { ok: true, core: { ...core, owned, offers, ...removeProject(core, p.id) } };
};
