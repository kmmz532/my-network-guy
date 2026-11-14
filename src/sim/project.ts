// 案件の流れ（受注・設計・施工・検収・納品）。状態を受け取り、新しい状態を返す純粋関数で書く。
// 設計は機器の配置・配線・IP設定、施工は社員が作業時間をかけて行い、検収で達成条件を判定する。
import type { OpFailReason } from './failReason';
import { applyMoney, recordSaving } from './ledger';
import type { Balance, Contract, Furniture, FloorId, GameMap, Staff } from '../data/schema';
import type { Facing } from './facing';





import { isSwitchedRouterCategory } from '../network/category';
import { engineWithWalls } from './walls';
import type { Offer } from '../contracts/template';

import { ipToInt } from '../network/engine';
import type { IssueDetail } from '../network/engine/stages/addressing';
import { analyze } from '../network/engine/analyze';
import type { NetworkState } from '../network/engine/state';
import { intToIp, planFor } from '../network/segments';
import { fillPlans, planDomainOf } from '../network/query/plans';
import type { PlanDomain } from '../network/engine/stages/l2';

import type { DhcpPool } from '../network/dhcp';
import type { EngineData, FailureReason, NetLink, NetNode, Network, PathResult, NetworkPlan, HostEntry } from '../network/types';

import type { ClockState } from './clock';


import { DELEGATE_MIN_COUNT, familiarKeyOf, missingFixed, positionsMatch, type Familiarity } from './familiar';



import { type Stars } from './blindDelegate';
import { CATEGORY, isPcCategory } from '../data/categories';
import { cableLengthOf, checkCableLength } from './cableLength';

import { makeIface } from '../network/iface';
import { can } from '../network/capabilities';
import { deviceCategory, portCountOf, devicePrice, devicePortType, cableDef } from '../registry/query';
import type { CableDef } from '../registry/defs';
import { dhcpWriteBack } from '../network/engine/analyze';
import type { VlanWarning } from '../network/query/warnings';
import { type LevelUp } from './level';

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
  inheritedLinks: string[];
  phase: 'design' | 'build';
  progress: number;
  total: number;
  // 期日（ゲーム内の日の番号）。期日のない案件は null
  due: number | null;
  // 担当の社員（uid）。施工の進みと経験値は担当の社員だけに効く
  crew: string[];
  // セグメントの設定（代表端点の鍵 "uid:port" → ネットワークアドレスとプレフィックス長）
  plans: Record<string, NetworkPlan>;
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
  warnings: VlanWarning[];
}

// 検収で判定した経路（画面にパケットとして流す）
export interface Trace {
  kind: 'ping' | 'http';
  src: string;
  dst: string;
  result: PathResult;
  // 判定した達成条件の番号（案件の goals の位置）。ターミナルの ping など達成条件でないものは持たない
  goal?: number;
}

// 案件の費用の内訳。機器は、案件で自分で置いた機器（既設でも引き継いだものでもない）の定価の合計。配線は、配線の費用の合計
export interface ProjectCost {
  total: number;
  devices: number;
  cable: number;
}

export const projectCostOf = (p: Project): ProjectCost => {
  // 既設の機器（案件で置かれたもの）と、自社オフィスから引き継いだ機器（前の案件で買った分）は含めない
  const inherited = new Set(p.inherited ?? []);
  const devices = p.nodes.reduce(
    (sum, n) => (n.locked || inherited.has(n.uid) ? sum : sum + devicePrice(n.device)),
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
  check?: { projectId: string; goals: GoalCheck[]; warnings?: VlanWarning[] };
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
  // 向き（座った社員が向く方向。省略は up・N95）
  facing?: Facing;
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

// 部屋の種類（主の部屋と、辺の別室。N92）
export type RoomId = 'main' | OfficeSide;

export interface Office {
  // 部屋ごとの床の種類（N92）。書いていない部屋は木
  floors?: Partial<Record<RoomId, FloorId>>;
  // 買い切りの床（一度買えば、どの部屋にも無料で敷ける・N125）
  bought: FloorId[];
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
  plans: Record<string, NetworkPlan>;
}

// 自社案件で得た効果の合計
export interface Effects {
  buildSpeed: number;
}

// 社員の席になる家具（机）のID。PCはこの家具の上にだけ置ける
export const DESK_ID = 'desk';

// 席になる家具（机。定義の seat が true のもの。N44 で机だけの品目も席として数える）。定義がなければ DESK_ID だけを机とする
export const isDeskFurniture = (id: string, env: Env): boolean => (env.furniture?.[id]?.seat ?? false) || id === DESK_ID;

export const emptyOffice = (size: OfficeSize): Office => ({ bought: ['wood' as const], plans: {},
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
  // 初めて出した用語（用語集の ID）。セーブに入る
  termsShown: string[];
}

// 機材の性質（ゲームデータから作る）
export interface Env {
  balance: Balance;
  // 家具の定義（家具の補正に使う）。省略すると補正はない
  furniture?: Record<string, Furniture>;
  engine: EngineData;
  // 地図（壁の判定に使う）。案件の地図のIDから引く。省略すると壁はない（N151）
  mapOf?: (id: string) => GameMap | undefined;
}

export type Outcome = { ok: true; core: Core; report?: Report } | { ok: false; reason: OpFailReason };

// 操作の失敗を返す（理由は ui.error.<理由> の鍵と対応する）。失敗の形はここだけで作る（N119）
export const fail = (reason: OpFailReason): Outcome => ({ ok: false, reason });

// 配線の定価から、払う額（経理の割引のあと）。割引がなければ定価のまま
export const paidCable = (core: Core, list: number): number => Math.round(list * (1 - core.purchaseDiscount));

// 型紙をつなぐ先（N70）: 近くのスイッチかルーターのうち、空きのポートがあるもの。足りない機器は、ここにつなぐ
const isHubCategory = (category: string): boolean =>
  category === CATEGORY.l2Switch || category === CATEGORY.router || category === CATEGORY.l3Switch || isSwitchedRouterCategory(category);

export const hubFor = (nodes: readonly NetNode[], links: readonly NetLink[], from: NetNode): NetNode | null => {
  let best: NetNode | null = null;
  let bestDist = Infinity;
  for (const n of nodes) {
    if (n.uid === from.uid || !isHubCategory(deviceCategory(n.device))) continue;
    if (usedPorts(links, n).size >= portCountOf(n.device)) continue;
    const dist = Math.abs(n.x - from.x) + Math.abs(n.y - from.y);
    if (dist < bestDist) {
      best = n;
      bestDist = dist;
    }
  }
  return best;
};

// 任せられるかの理由（任せられるなら null）（N70）。型紙の固定の機器の位置が合い、増えた機器をつなぐ先があること
export const delegationReason = (familiarity: Familiarity, offer: Offer): OpFailReason | null => {
  if (offer.contract.inhouse) return 'inhouse';
  const key = familiarKeyOf(offer.kind, offer.baseId, offer.contract.map);
  if ((familiarity.counts[key] ?? 0) < DELEGATE_MIN_COUNT) return 'delegate.count';
  const bp = familiarity.blueprints[key];
  if (!bp) return 'delegate.blueprint';
  const fixed = fixedNodes(offer.contract);
  if (!positionsMatch(bp.design, fixed)) return 'delegate.fit';
  const reachable = missingFixed(bp.design, fixed).every((m) => hubFor(bp.design.nodes, bp.design.links, m) !== null);
  return reachable ? null : 'delegate.fit';
};

// 社員に任せて受注する（N70）。型紙を写し、テストを通してから施工に入る。★と経験値の上限は検収で掛ける
// 任せて受注したあとも、画面の対象（focus）は受注の前のまま残す（現場に移さない・N111）
export const keepFocus = (before: Core, outcome: Outcome): Outcome => (outcome.ok ? { ...outcome, core: { ...outcome.core, focus: before.focus } } : outcome);

// 案件で最初から置かれている機器
export const fixedNodes = (contract: Contract): NetNode[] =>
  contract.placed.map((p, i) => ({
    uid: p.ref,
    device: p.device,
    // MAC アドレスの連番。置いた順に振る（プレイヤーが置く機器は nextMacSerial で振る）
    macSerial: i + 1,
    ports: [],
    ...(p.name ? { name: p.name } : {}),
    x: p.x,
    y: p.y,
    locked: p.locked,
    configLocked: p.config?.locked ?? false,
    interfaces: (p.config?.interfaces ?? []).map((i) => ({ ...makeIface(p.device, i.port, i.ip, i.prefix), ...(i.dhcp ? { dhcp: true as const } : {}) })),
    gateway: p.config?.gateway ?? null,
    routes: [],
    services: (p.config?.services ?? []).map((s) => ({ ...s })),
  }));

// 設計・表示の対象の案件を取り出す（なければ null）
export const focusedOf = (core: Core): Project | null =>
  core.focus === null ? null : (core.active.find((p) => p.id === core.focus) ?? null);

// 案件を差し替える（同じIDの案件を置き換える）
export const withProject = (core: Core, next: Project): Core => ({
  ...core,
  active: core.active.map((p) => (p.id === next.id ? next : p)),
});

// 設計中の案件を取り出す。設計中でなければ理由を返す
export const requireDesign = (core: Core): Project | OpFailReason => {
  const p = focusedOf(core);
  if (!p) return 'none';
  if (p.phase !== 'design') return 'phase';
  return p;
};

// 在庫から機器を1台配置する。自社案件では自社オフィスと同じ規則に従い、ほかの案件では床（PCは机の上も可）に置ける。
// 家庭用ルーターの出荷時の設定（NET.md §4）: LAN の口（1）に 192.168.1.1/24・社内側の口・NAPT 有効・DHCP（192.168.1.100〜199 を配る）。無線つきは SSID とパスワードも持つ。ほかの機器は何も持たない
const FACTORY_WIFI = { ssid: 'HOME', password: 'home1234' };
export const factoryConfigOf = (deviceId: string): Pick<NetNode, 'interfaces' | 'napt' | 'wireless' | 'rules' | 'dhcpPools'> => {
  const category = deviceCategory(deviceId);
  if (category !== CATEGORY.homeRouter) return { interfaces: [] };
  const lan = { ...makeIface(deviceId, 1, '192.168.1.1', 24), nat: 'inside' as const };
  const wireless = deviceId === 'home_router_ap' ? { wireless: { ...FACTORY_WIFI } } : {};
  return {
    interfaces: [lan],
    napt: true,
    rules: [{ src: '192.168.1.0/24', dst: 'any', service: 'any' }],
    dhcpPools: [{ network: '192.168.1.0', prefix: 24, start: '192.168.1.100', end: '192.168.1.199', gateway: '192.168.1.1', dns: '192.168.1.1' }],
    ...wireless,
  };
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
  plans: Record<string, NetworkPlan>;
}

// 対象のネットワークを取り出す。設計中の案件でない、または自社オフィスが案件に使われていれば理由を返す
export const netOf = (core: Core, target: NetTarget): Net | OpFailReason => {
  if (target === 'office') {
    if (officeLocked(core)) return 'inhouse';
    const o = core.office;
    return { nodes: o.nodes, links: o.links, seq: o.seq, plans: o.plans };
  }
  const p = requireDesign(core);
  if (typeof p === 'string') return p;
  return { nodes: p.nodes, links: p.links, seq: p.seq, plans: p.plans };
};

// 対象のネットワークを書き戻す
// 受け取れた自動（DHCP）の口のアドレスを、前回のアドレスとして機器へ書き戻す（NET.md §5.7）。store が操作を確定するたびに呼ぶ。
// 判定のデータは、ping などと同じ（案件の地図の壁を含む）ものを使う。書き戻すものがなければ同じ core を返す
export const writeBackDhcp = (core: Core, env: Env): Core => {
  const officeNodes = dhcpWriteBack(core.office.nodes, core.office.links, core.office.plans, engineWithWalls(env.engine, env.mapOf?.('hq')));
  let changed = officeNodes !== core.office.nodes;
  const active = core.active.map((p) => {
    const nodes = dhcpWriteBack(p.nodes, p.links, p.plans, engineWithWalls(env.engine, env.mapOf?.(p.contract.map)));
    if (nodes === p.nodes) return p;
    changed = true;
    return { ...p, nodes: [...nodes] };
  });
  return changed ? { ...core, office: { ...core.office, nodes: [...officeNodes] }, active } : core;
};

export const withNet = (core: Core, target: NetTarget, net: Net): Core => {
  if (target === 'office') {
    return { ...core, office: { ...core.office, nodes: net.nodes, links: net.links, seq: net.seq, plans: net.plans } };
  }
  const p = focusedOf(core) as Project;
  // 設計を変えたので、最後のテストの結果は無効になる
  return withProject(core, { ...p, nodes: net.nodes, links: net.links, seq: net.seq, plans: net.plans, testedOk: false });
};

// 機器の口が属する計画の単位の L2 ドメイン（配線がなければ undefined）
export const planDomainAt = (net: Net, env: Env, uid: string, port: number): PlanDomain | undefined =>
  planDomainOf(analyze(net, env.engine), { node: uid, port });

// 機器のポートのうち、ケーブルがつながっている番号の集合
const usedPorts = (links: readonly NetLink[], node: NetNode): Set<number> => {
  const used = new Set<number>();
  for (const l of links) {
    if (l.a.node === node.uid) used.add(l.a.port);
    if (l.b.node === node.uid) used.add(l.b.port);
  }
  return used;
};

// 機器の空いているポートのうち、ケーブルの口の種類と合う最も小さい番号を返す（合う口がなければ、空きの最小番号。種類の不一致は配線の判定が理由を出す）
const freePort = (links: NetLink[], node: NetNode, cablePort: string): number | null => {
  const used = usedPorts(links, node);
  const count = portCountOf(node.device);
  for (let port = 0; port < count; port++) if (!used.has(port) && portTypeOf(node.device, port) === cablePort) return port;
  for (let port = 0; port < count; port++) if (!used.has(port)) return port;
  return null;
};

// 配線で使うポートの指定。省略（undefined）なら空きの最小番号を使う
export interface PortChoice {
  a?: number;
  b?: number;
}

// 機器のポートを決める。指定があればそのポートを確かめる（範囲外は port、使用中は portUsed）。指定がなければ空きの最小番号（空きがなければ port）
// 機器の口の種類（定義にない機器・口は rj45）
export const portTypeOf = (device: string, port: number): string => devicePortType(device, port);

const choosePort = (links: NetLink[], node: NetNode, want: number | undefined, cablePort: string): number | OpFailReason => {
  if (want === undefined) return freePort(links, node, cablePort) ?? 'port';
  const count = portCountOf(node.device);
  if (!Number.isInteger(want) || want < 0 || want >= count) return 'port';
  return usedPorts(links, node).has(want) ? 'portUsed' : want;
};

// 2台の機器を配線できるか判定する。できなければ理由を返す（配線中の表示と配線の実行で使う）。ports を省略すると空きのポートを使う
export const checkConnect = (
  core: Core,
  aUid: string,
  bUid: string,
  cableId: string,
  target: NetTarget = 'focus',
  ports: PortChoice = {},
): OpFailReason | null => {
  const net = netOf(core, target);
  if (typeof net === 'string') return net;
  const a = net.nodes.find((n) => n.uid === aUid);
  const b = net.nodes.find((n) => n.uid === bUid);
  const cable = cableDef(cableId);
  if (!a || !b || aUid === bUid || !cable) return 'none';
  const length = cableLengthOf(a, b);
  const lengthCheck = checkCableLength(length, cable.maxLengthTiles);
  if (lengthCheck !== 'ok') return lengthCheck;
  if (core.clock.money < paidCable(core, cable.pricePerLink + cable.pricePerTile * length)) return 'money';
  // 回線終端（uplink）は、回線（wan）の能力を持つ機器だけとつなげる（N144）
  const uplinkRule = (x: NetNode, y: NetNode): OpFailReason | null =>
    deviceCategory(x.device) === 'uplink' && !can(y.device, 'wan') ? 'uplink.no_wan' : null;
  const uplinkBad = uplinkRule(a, b) ?? uplinkRule(b, a);
  if (uplinkBad) return uplinkBad;
  // ケーブルの口の種類（光ファイバーは sfp の口だけ）が、両端の口と合うか（N-sfp）
  const cablePort = cable.port ?? 'rj45';
  const portA = choosePort(net.links, a, ports.a, cablePort);
  if (typeof portA === 'string') return portA;
  const portB = choosePort(net.links, b, ports.b, cablePort);
  if (typeof portB === 'string') return portB;
  if (portTypeOf(a.device, portA) !== cablePort || portTypeOf(b.device, portB) !== cablePort) return 'cable.port_type';
  return null;
};

// 空いているポートの数（描画で使う）
// 数え方は usedPorts と同じ（判定と描画で数えが食い違わないように、1か所にする）（N115）
export const freePortCount = (p: Project, node: NetNode): number => portCountOf(node.device) - usedPorts(p.links, node).size;

// ケーブル1本の費用（配線の長さで決まる）
export const cableCost = (cable: CableDef, length: number): number => cable.pricePerLink + cable.pricePerTile * length;

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
  const reason = checkConnect(core, aUid, bUid, cableId, target, ports);
  if (reason) return fail(reason);
  const net = netOf(core, target);
  if (typeof net === 'string') return fail(net);
  const a = net.nodes.find((n) => n.uid === aUid);
  const b = net.nodes.find((n) => n.uid === bUid);
  // 機器が見つからないのは、画面と状態のずれ。黙って進めず、理由を返す
  if (!a || !b) return fail('none');
  const cable = cableDef(cableId);
  const length = cableLengthOf(a, b);
  const listCost = cableCost(cable, length);
  const cost = paidCable(core, listCost);
  const chosenA = choosePort(net.links, a, ports.a, cable.port ?? 'rj45');
  const chosenB = choosePort(net.links, b, ports.b, cable.port ?? 'rj45');
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
    paid: cost,
  };
  const links = [...net.links, link];
  const plans = fillPlans(analyze({ nodes: net.nodes, links, plans: net.plans }, env.engine));
  let next = withNet(core, target, { nodes: net.nodes, links, seq: net.seq + 1, plans });
  if (target === 'focus') {
    const p = focusedOf(next) as Project;
    next = withProject(next, { ...p, cost: p.cost + cost });
  }
  // 割引で浮いた額は、節約として帳簿に残す（資金は変えない）
  return { ok: true, core: { ...next, clock: recordSaving(applyMoney(next.clock, -cost, 'construction'), listCost - cost) } };
};

// 名前と IPアドレスの表を、同じ案件（自社オフィス）の機器から作る。ホスト名のある機器の、最初の IPアドレスを登録する（N68）
export const zoneFromNodes = (nodes: readonly NetNode[]): HostEntry[] =>
  nodes.flatMap((n) => (n.hostname && n.interfaces[0] ? [{ name: n.hostname, ip: n.interfaces[0].ip }] : []));

// 同じホスト名が2つ以上ある名前の一覧（DNS の自動登録の警告に使う）
export const duplicateHostnames = (nodes: readonly NetNode[]): string[] => {
  const count = new Map<string, number>();
  for (const n of nodes) if (n.hostname) count.set(n.hostname, (count.get(n.hostname) ?? 0) + 1);
  return [...count].filter(([, c]) => c > 1).map(([name]) => name);
};

// 口のモードの変更。trunk の allowed は null で全 VLAN を許可、native は省略すると今の値（なければ 1）を保つ
export type PortModeChange =
  | { kind: 'access'; vlan: number }
  | { kind: 'routed' }
  | { kind: 'trunk'; allowed?: number[] | null; native?: number };

// OSPF の機器・インターフェースの設定（ルーター ID・既定の経路の配布・コスト・優先度・Hello・デッド）
export type OspfOp =
  | { op: 'routerId'; ip: string | null }
  | { op: 'defaultOriginate'; on: boolean }
  | { op: 'iface'; id: string; key: 'cost' | 'priority' | 'hello' | 'dead'; value: number };

// VRRP の設定（グループの作成・仮想の IP アドレス・優先度・プリエンプト・追跡・削除）。ip で、グループがなければ作る（優先度 100・プリエンプトあり）
export type VrrpOp =
  | { op: 'ip'; id: string; vrid: number; ip: string }
  | { op: 'priority'; id: string; vrid: number; value: number }
  | { op: 'preempt'; id: string; vrid: number; on: boolean }
  | { op: 'track'; id: string; vrid: number; iface: string; decrement: number }
  | { op: 'remove'; id: string; vrid: number };

// スパニングツリーの設定（ブリッジ優先度・口のコスト）。stp を持つスイッチだけ
export type StpOp = { op: 'priority'; value: number } | { op: 'cost'; port: number; value: number };

// DHCP の設定（NET.md §5.7）: 口を自動にする（client）・リレー先（helper）・プール（pool・noPool）
export type DhcpOp =
  | { op: 'client'; port: number }
  | { op: 'helper'; port: number; ip: string | null }
  | { op: 'pool'; pool: DhcpPool }
  | { op: 'noPool'; network: string };

// リンクアグリゲーションの設定（口のチャネルの番号と、まとめるモード）。lag を持つ機器だけ。group が null なら解除
export type ChannelOp = { port: number; group: number | null; lacp?: 'active' | 'passive' | 'on' };

// NAT の設定（N145）。口の inside・outside、NAPT の有効、静的 NAT（ポートの転送）
export type NatOp =
  | { op: 'iface'; id: string; nat: 'inside' | 'outside' | null }
  | { op: 'napt'; on: boolean }
  | { op: 'static'; port: number; insideIp: string; insidePort: number }
  | { op: 'noStatic'; port: number };

// BGP の設定（N147）。router bgp で自分の AS を決め、neighbor と network を足す
export type BgpOp = { op: 'asn'; asn: number } | { op: 'off' } | { op: 'neighbor'; ip: string; remoteAs: number } | { op: 'removeNeighbor'; ip: string } | { op: 'removeNetwork'; dest: string; prefix: number } | { op: 'attr'; ip: string; key: 'nextHopSelf'; value: boolean } | { op: 'attr'; ip: string; key: 'localPref' | 'med' | 'prepend'; value: number } | { op: 'network'; dest: string; prefix: number };

// 配線の片方の端（a か b）を、同じ機器の別のポートへ挿し替える。埋まったポートには挿せない。
// ケーブルの長さは変わらないため費用は変えない。ポートのIPアドレスは、ポートの番号に付いたまま残す。
export type End = 'a' | 'b';

// アドレスの候補（セグメントで使えるアドレスの一覧）。使用中のアドレスには、使っている機器とポートを付ける
export interface AddressCandidate {
  ip: string;
  usedBy: { node: string; port: number } | null;
}

// 候補の一覧の上限（先頭から並べる）。/8 のような広いネットワークで全部を並べないため
const MAX_ADDRESS_CANDIDATES = 256;

// ネットワーク（先頭アドレスと prefix）で使えるアドレスの一覧。ネットワークアドレスとブロードキャストアドレスを除き、.1 から順に並べる（/31・/32 は全部）。
// 設定の前でも後でも同じ範囲・同じ順になる。使用中のアドレスには、使っている機器とポートを付ける（同じネットワーク内のすべての機器を見る）
const addressRange = (
  network: string,
  prefix: number,
  nodes: Array<{ uid: string; interfaces: Array<{ port: number; ip: string }> }>,
): AddressCandidate[] => {
  const base = ipToInt(network);
  const size = 2 ** (32 - prefix);
  const point = prefix >= 31;
  const first = point ? 0 : 1;
  const last = point ? size - 1 : size - 2;
  const owners = new Map<number, { node: string; port: number }>();
  for (const n of nodes) for (const i of n.interfaces) owners.set(ipToInt(i.ip), { node: n.uid, port: i.port });
  const list: AddressCandidate[] = [];
  for (let h = first; h <= last && list.length < MAX_ADDRESS_CANDIDATES; h++) list.push({ ip: intToIp(base + h), usedBy: owners.get(base + h) ?? null });
  return list;
};

// 機器のポートのセグメントで使えるアドレスの一覧（addressRange と同じ）。
// セグメントに設定がなければ空の一覧
export const addressCandidates = (core: Core, uid: string, port: number, env: Env, target: NetTarget = 'focus'): AddressCandidate[] => {
  const net = netOf(core, target);
  if (typeof net === 'string') return [];
  const domain = planDomainAt(net, env, uid, port);
  if (!domain) return [];
  const cfg = planFor(domain, new Map(net.nodes.map((n) => [n.uid, n])), net.plans);
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
export const stateOfProject = (p: Project, env: Env): NetworkState => analyze({ nodes: p.nodes, links: p.links, plans: p.plans }, env.engine);

export const compiledNet = (p: Project, env: Env): Network => stateOfProject(p, env).addressing.net;

// 設計時点の不備（機器の uid -> 不備の内容）
export const designIssues = (p: Project, env: Env): Record<string, IssueDetail> => stateOfProject(p, env).addressing.issues;

export type TestOutcome = { ok: true; core: Core; result: TestResult } | { ok: false; reason: OpFailReason };

// 型紙なしで任せる（N94）。設計は作らず、結果を乱数で決める。費用は予算 × 費用の割合を払い、報酬は★の倍率で決まる。
// 経験値は半分。設計は地図に残さない（結果画面は★・費用・報酬）
// 受注して施工に入る。結果（★・費用の割合・手直し）は受注のときに乱数で決めて案件に持たせ、施工が終わったら納品する（settleBlind）
export type BlindOutcome = { ok: true; core: Core; rng: number } | { ok: false; reason: OpFailReason };

// 機器の種類が PC か（環境の機器の定義を引く。判定はここだけで行う。N116）
export const isPcIn = (_env: Env, device: string): boolean => isPcCategory(deviceCategory(device));

// 自社オフィスの回線終端。会社のレベルが balance.featureUnlocks.uplink に届くと、置き場所を選んで1つ置ける（費用なし）。
// 置いた回線終端は既設の機器として扱う（撤去・設定の変更はできない）。位置は balance.office.uplinkMoveCost を支払って変更できる
export const OFFICE_UPLINK_UID = 'uplink';

export const officeUplinkOf = (office: Office): NetNode | undefined =>
  office.nodes.find((n) => deviceCategory(n.device) === CATEGORY.uplink);
