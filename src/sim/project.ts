// 案件の流れ（受注・設計・施工・検収・納品）。状態を受け取り、新しい状態を返す純粋関数で書く。
// 設計は機器の配置・配線・IP設定、施工は社員が作業時間をかけて行い、検収で達成条件を判定する。
import type { Balance, Contract, Furniture, GameMap, Staff } from '../data/schema';
import type { Offer } from '../contracts/template';
import { evaluateContract } from '../network/goals';
import { inSubnet, ipToInt, linkLength } from '../network/engine';
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
  epKey,
  type Segment,
} from '../network/segments';
import type {
  EngineData,
  Endpoint,
  FailureReason,
  Iface,
  NetLink,
  NetNode,
  PathResult,
  Route,
  SegmentConfig,
  Service,
} from '../network/types';
import type { ClockState } from './clock';
import { rate, rewardRateOf } from './rating';
import { dueDayOf, lateDaysOf, lateFactor } from './deadline';
import { furnitureBonus, type BonusEnv } from './furniture';
import { gainExp, staffPower } from './staff';

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

export interface Report {
  passed: boolean;
  // 納品した案件（納品後の表示に使う）
  delivered?: Project;
  // 納品が遅れた日数（期日内なら0）
  lateDays?: number;
  // 結果画面に出す、費用・予算・失敗回数
  cost?: number;
  budget?: number;
  rework?: number;
  traces: Trace[];
  // 不合格のとき、達成条件ごとの判定（マップの「×」と案件の欄で使う）
  check?: { projectId: string; goals: GoalCheck[] };
  stars?: 1 | 2 | 3;
  money?: number;
  // 評判の増え分（報酬の評判と★による評判の合計）
  reputationGain?: number;
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

export interface Office {
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

export const emptyOffice = (): Office => ({ nodes: [], links: [], seq: 0, furniture: [], furnitureSeq: 0 });
export const noEffects = (): Effects => ({ buildSpeed: 0 });

export interface Core {
  clock: ClockState;
  reputation: number;
  owned: Record<string, number>;
  completed: string[];
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
}

// 機材の性質（ゲームデータから作る）
export interface DeviceInfo {
  category: string;
  price: number;
  portCount: number;
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

// 案件で最初から置かれている機器
const fixedNodes = (contract: Contract): NetNode[] =>
  contract.placed.map((p) => ({
    uid: p.ref,
    device: p.device,
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
    return member !== undefined && member.training === null && !busy.has(uid);
  };
  if (!crew.every(free)) return fail('crew');
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
// PCは机の家具があり、その上に機器がないマスだけ。PC以外は床で、家具も機器もないマスだけ
const officePlaceReason = (
  furniture: PlacedFurniture[],
  nodes: NetNode[],
  deviceId: string,
  x: number,
  y: number,
  map: GameMap,
  env: Env,
): string | null => {
  const hasNode = nodes.some((n) => n.x === x && n.y === y);
  if (env.devices[deviceId].category === 'pc') {
    const onDesk = furniture.some((f) => f.x === x && f.y === y && f.id === DESK_ID);
    return !onDesk || hasNode ? 'desk' : null;
  }
  const kind = map.legend[map.tiles[y][x]];
  if (kind !== 'floor') return 'tile';
  if (hasNode || furniture.some((f) => f.x === x && f.y === y)) return 'tile';
  return null;
};

// 在庫から機器を1台配置する。自社案件では自社オフィスと同じ規則に従い、ほかの案件では床（PCは机の上も可）に置ける。
export const placeDevice = (core: Core, deviceId: string, x: number, y: number, map: GameMap, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  if (!env.devices[deviceId]) return fail('none');
  if ((core.owned[deviceId] ?? 0) < 1) return fail('stock');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  if (p.contract.inhouse) {
    const reason = officePlaceReason(core.office.furniture, p.nodes, deviceId, x, y, map, env);
    if (reason) return fail(reason);
  } else {
    // 床に置く。PCは机の上にも置ける
    const kind = map.legend[map.tiles[y][x]];
    if (kind !== 'floor' && !(kind === 'desk' && env.devices[deviceId].category === 'pc')) return fail('tile');
    if (p.nodes.some((n) => n.x === x && n.y === y)) return fail('tile');
  }
  const node: NetNode = {
    uid: `u${p.seq}`,
    device: deviceId,
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
export const placeInOffice = (core: Core, deviceId: string, x: number, y: number, map: GameMap, env: Env): Outcome => {
  if (officeLocked(core)) return fail('inhouse');
  if (!env.devices[deviceId]) return fail('none');
  if ((core.owned[deviceId] ?? 0) < 1) return fail('stock');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  const office = core.office;
  const reason = officePlaceReason(office.furniture, office.nodes, deviceId, x, y, map, env);
  if (reason) return fail(reason);
  const node: NetNode = {
    uid: `u${office.seq}`,
    device: deviceId,
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
interface Net {
  nodes: NetNode[];
  links: NetLink[];
  seq: number;
  segments: Record<string, SegmentConfig>;
}

// 対象のネットワークを取り出す。設計中の案件でない、または自社オフィスが案件に使われていれば理由を返す
const netOf = (core: Core, target: NetTarget): Net | string => {
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
const withNet = (core: Core, target: NetTarget, net: Net): Core => {
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
const usedPorts = (links: NetLink[], node: NetNode): Set<number> => {
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
  if (length < 1 || length > cable.maxLengthTiles) return 'cable';
  if (core.clock.money < cable.pricePerLink + cable.pricePerTile * length) return 'money';
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
  const net = netOf(core, target) as Net;
  const a = net.nodes.find((n) => n.uid === aUid) as NetNode;
  const b = net.nodes.find((n) => n.uid === bUid) as NetNode;
  const cable = env.cables[cableId];
  const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const cost = cableCost(cable, length);
  const portA = choosePort(net.links, a, env, ports.a) as number;
  const portB = choosePort(net.links, b, env, ports.b) as number;
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
  return { ok: true, core: { ...next, clock: { ...next.clock, money: next.clock.money - cost } } };
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
      refund = cableCost(cable, Math.abs(a.x - b.x) + Math.abs(a.y - b.y));
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
      clock: { ...next.clock, money: next.clock.money + refund },
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

// IPアドレスの書式（各区切りは 0〜255）
const isIp = (s: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(s) && s.split('.').every((n) => Number(n) <= 255);

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

// セグメントのネットワークを設定する。ホストの初期値は .11 から、ルーターの初期値は .1 から、空いているアドレスを割り当てる。
// 設定の変更で範囲外になったアドレスは、割り当て直す。案件で設定が固定された機器を含むセグメントは変えられない。
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

  const base = ipToInt(network);
  const size = 2 ** (32 - prefix);
  const ifaceOf = (m: Endpoint) => byUid.get(m.node)?.interfaces.find((i) => i.port === m.port);
  // 割り当てし直す端点: 機器がないか、範囲外のアドレスの端点
  const todo = seg.members.filter((m) => {
    const i = ifaceOf(m);
    return !i || !inSubnet(i.ip, network, prefix);
  });
  const todoKeys = new Set(todo.map((m) => epKey(m.node, m.port)));
  const used = new Set<number>();
  for (const n of net.nodes) for (const i of n.interfaces) if (!todoKeys.has(epKey(n.uid, i.port))) used.add(ipToInt(i.ip));
  const pickFree = (from: number): number | undefined => {
    for (let h = from; h <= size - 2; h++) if (!used.has(base + h)) return h;
    return undefined;
  };
  const assigned = new Map<string, string>();
  for (const m of todo) {
    const isRouter = env.engine.categoryOf(byUid.get(m.node)!.device) === 'router';
    const h = pickFree(isRouter ? 1 : 11) ?? pickFree(1);
    if (h === undefined) continue;
    used.add(base + h);
    assigned.set(epKey(m.node, m.port), intToIp(base + h));
  }

  const nodes = net.nodes.map((n) => {
    let interfaces = n.interfaces;
    for (const m of todo) {
      if (m.node !== n.uid) continue;
      const ip = assigned.get(epKey(m.node, m.port));
      if (ip) interfaces = [...interfaces.filter((i) => i.port !== m.port), { port: m.port, ip, prefix }];
    }
    return interfaces === n.interfaces ? n : { ...n, interfaces };
  });
  const segments = { ...net.segments, [seg.key]: { network, prefix } };
  return { ok: true, core: withNet(core, target, { ...net, nodes, segments }) };
};

// アドレスの候補（セグメントで使えるアドレスの一覧）。使用中のアドレスには、使っている機器とポートを付ける
export interface AddressCandidate {
  ip: string;
  usedBy: { node: string; port: number } | null;
}

// 機器のポートのセグメントで使えるアドレスの一覧（ネットワークアドレスとブロードキャストアドレスを除く）。
// セグメントに設定がなければ空の一覧
export const addressCandidates = (core: Core, uid: string, port: number, env: Env, target: NetTarget = 'focus'): AddressCandidate[] => {
  const net = netOf(core, target);
  if (typeof net === 'string') return [];
  const seg = segmentAt(net, env, uid, port);
  if (!seg) return [];
  const cfg = segmentConfigOf(seg, new Map(net.nodes.map((n) => [n.uid, n])), net.segments);
  if (!cfg) return [];
  const base = ipToInt(cfg.network);
  const size = 2 ** (32 - cfg.prefix);
  const owners = new Map<number, { node: string; port: number }>();
  for (const n of net.nodes) for (const i of n.interfaces) owners.set(ipToInt(i.ip), { node: n.uid, port: i.port });
  const list: AddressCandidate[] = [];
  for (let h = 1; h <= size - 2; h++) list.push({ ip: intToIp(base + h), usedBy: owners.get(base + h) ?? null });
  return list;
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
export const advanceBuild = (core: Core, env: Env, hour: number): Outcome => {
  const { workStartHour, workEndHour } = env.balance.build;
  const working = hour >= workStartHour && hour < workEndHour;
  const bonusEnv: BonusEnv = { defs: env.furniture ?? {}, balance: env.balance, staffUids: core.staff.map((s) => s.uid) };
  const crewOf = (p: Project) => core.staff.filter((s) => p.crew.includes(s.uid));
  // 施工中の案件の担当は、勤務時間内に1ゲーム時間ぶんの経験値を得る（着席の社員は家具の補正を受ける）
  let state: Core = core;
  if (working) {
    const building = new Set(core.active.filter((p) => p.phase === 'build').flatMap((p) => p.crew));
    if (building.size > 0) {
      const hours = env.balance.time.gameMinutesPerTick / 60;
      state = {
        ...core,
        staff: core.staff.map((s) =>
          building.has(s.uid)
            ? gainExp(s, hours * (1 + furnitureBonus(core.office, s.uid, bonusEnv).exp), env.balance.staff.expPerLevel)
            : s,
        ),
      };
    }
  }
  for (const p of core.active) {
    if (p.phase !== 'build') continue;
    // 施工の進みは、担当の社員の施工力の合計に比例する
    const power = crewOf(p).reduce((sum, s) => sum + staffPower(s, undefined, core.office, bonusEnv), 0);
    let progress = p.progress;
    if (working) progress += env.balance.time.gameMinutesPerTick * power * (1 + core.effects.buildSpeed);
    if (progress < p.total) {
      state = withProject(state, { ...p, progress });
      continue;
    }
    const built = {
      nodes: p.nodes.map((n) => n.uid),
      links: p.links.map((l) => l.uid),
    };
    return inspect(withProject(state, { ...p, progress, built }), env, p.id);
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

// 検収: 達成条件を判定する。合格なら納品して報酬と評判を得る。不合格なら設計に戻す（テストの結果を画面に残す）。
export const inspect = (core: Core, env: Env, id: string): Outcome => {
  const p = core.active.find((x) => x.id === id);
  if (!p) return fail('none');
  const j = judge(p, env);
  const traces = j.traces;
  if (j.passed) {
    // 期日に遅れたら、遅れた日数に応じて報酬が減り、★は2が上限になる
    const lateDays = lateDaysOf(p.due, core.clock.minute);
    const stars = rate(p.cost, p.contract.budget, p.rework, lateDays > 0, env.balance);
    // 報酬は、期日の割合と★ごとの倍率を掛けた額
    const money = Math.round(p.contract.reward.money * lateFactor(lateDays, env.balance) * rewardRateOf(stars, env.balance));
    const reputation = core.reputation + p.contract.reward.reputation + stars * env.balance.reputationPerStar;
    // 自社案件は、納品したネットワークを自社オフィスとして残し、効果を加える
    const office: Office = p.contract.inhouse
      ? { ...core.office, nodes: p.nodes, links: p.links, seq: p.seq, segments: p.segments ?? {} }
      : core.office;
    const effects = { buildSpeed: core.effects.buildSpeed + (p.contract.effect?.buildSpeed ?? 0) };
    return {
      ok: true,
      core: {
        ...core,
        ...removeProject(core, p.id),
        office,
        effects,
        clock: { ...core.clock, money: core.clock.money + money },
        reputation,
        completed: p.kind === 'fixed' ? [...core.completed, p.baseId] : core.completed,
      },
      report: {
        passed: true,
        delivered: p,
        traces,
        stars,
        money,
        lateDays,
        cost: p.cost,
        budget: p.contract.budget,
        rework: p.rework,
        reputationGain: reputation - core.reputation,
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
  return { ok: true, core: { ...core, owned, ...removeProject(core, p.id) } };
};
