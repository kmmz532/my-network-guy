// 案件の流れ（受注・設計・施工・検収・納品）。状態を受け取り、新しい状態を返す純粋関数で書く。
// 設計は機器の配置・配線・IP設定、施工は社員が作業時間をかけて行い、検収で達成条件を判定する。
import type { Balance, Contract, GameMap } from '../data/schema';
import type { Offer } from '../contracts/template';
import { evaluateContract } from '../network/goals';
import { linkLength } from '../network/engine';
import { colorsFromConfig, compile, type Issue } from '../network/compile';
import type { EngineData, NetLink, NetNode, PathResult } from '../network/types';
import type { ClockState } from './clock';
import { rate } from './rating';

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
  phase: 'design' | 'build';
  progress: number;
  total: number;
}

export interface ReportFailure {
  reason: string;
  node: string;
  goal: string;
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
  traces: Trace[];
  // 手戻りのときに社員が出すヒント（言語キー）
  hint?: string;
  stars?: 1 | 2 | 3;
  money?: number;
  // 評判の増え分（報酬の評判と★による評判の合計）
  reputationGain?: number;
  failures: ReportFailure[];
}

// 自社オフィスのネットワーク。自社案件の納品で更新され、ずっと残る
export interface Office {
  nodes: NetNode[];
  links: NetLink[];
  seq: number;
}

// 自社案件で得た効果の合計
export interface Effects {
  buildSpeed: number;
}

export const emptyOffice = (): Office => ({ nodes: [], links: [], seq: 0 });
export const noEffects = (): Effects => ({ buildSpeed: 0 });

export interface Core {
  clock: ClockState;
  reputation: number;
  owned: Record<string, number>;
  completed: string[];
  offers: Offer[];
  active: Project | null;
  office: Office;
  effects: Effects;
}

// 機材の性質（ゲームデータから作る）
export interface DeviceInfo {
  category: string;
  price: number;
  portCount: number;
}

export interface CableInfo {
  pricePerLink: number;
  pricePerTile: number;
  maxLengthTiles: number;
}

export interface Env {
  balance: Balance;
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

const withActive = (core: Core, active: Project): Core => ({ ...core, active });

// 設計中の案件を取り出す。設計中でなければ理由を返す
const requireDesign = (core: Core): Project | string => {
  if (!core.active) return 'none';
  if (core.active.phase !== 'design') return 'phase';
  return core.active;
};

// 依頼を受注する。受注できるのは1件まで。
export const accept = (core: Core, offerId: string): Outcome => {
  if (core.active) return fail('busy');
  const offer = core.offers.find((o) => o.id === offerId);
  if (!offer) return fail('none');
  const inhouse = offer.contract.inhouse;
  const office = core.office;
  // 自社案件は、自社オフィスの機器と配線を引き継いで始める
  const fixed = colorsFromConfig(fixedNodes(offer.contract)).filter((n) => !inhouse || !office.nodes.some((o) => o.uid === n.uid));
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
    phase: 'design',
    progress: 0,
    total: 0,
  };
  return { ok: true, core: { ...core, offers: core.offers.filter((o) => o.id !== offerId), active: project } };
};

// 在庫から機器を1台配置する。床のマスにだけ置ける。
export const placeDevice = (core: Core, deviceId: string, x: number, y: number, map: GameMap, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  if (!env.devices[deviceId]) return fail('none');
  if ((core.owned[deviceId] ?? 0) < 1) return fail('stock');
  if (x < 0 || y < 0 || x >= map.width || y >= map.height) return fail('tile');
  // 床に置く。PCは机の上にも置ける
  const kind = map.legend[map.tiles[y][x]];
  if (kind !== 'floor' && !(kind === 'desk' && env.devices[deviceId].category === 'pc')) return fail('tile');
  if (p.nodes.some((n) => n.x === x && n.y === y)) return fail('tile');
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
    services: [],
    colors: {},
  };
  const next: Project = { ...p, nodes: [...p.nodes, node], seq: p.seq + 1 };
  return {
    ok: true,
    core: { ...withActive(core, next), owned: { ...core.owned, [deviceId]: core.owned[deviceId] - 1 } },
  };
};

// 施工前の機器を撤去する（在庫に戻る）。施工済みや既設の機器は撤去できない。
export const removeNode = (core: Core, uid: string): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  const node = p.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.locked || p.built.nodes.includes(uid)) return fail('locked');
  const removed = p.links.filter((l) => l.a.node === uid || l.b.node === uid);
  if (removed.some((l) => p.built.links.includes(l.uid))) return fail('locked');
  const next: Project = {
    ...p,
    nodes: p.nodes.filter((n) => n.uid !== uid),
    links: p.links.filter((l) => !removed.includes(l)),
  };
  const owned = { ...core.owned, [node.device]: (core.owned[node.device] ?? 0) + 1 };
  return { ok: true, core: { ...withActive(core, next), owned } };
};

// 2台の機器を配線できるか判定する。できなければ理由を返す（配線中の表示と配線の実行で使う）
export const checkConnect = (core: Core, aUid: string, bUid: string, cableId: string, env: Env): string | null => {
  const p = requireDesign(core);
  if (typeof p === 'string') return p;
  const a = p.nodes.find((n) => n.uid === aUid);
  const b = p.nodes.find((n) => n.uid === bUid);
  const cable = env.cables[cableId];
  if (!a || !b || aUid === bUid || !cable) return 'none';
  const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  if (length < 1 || length > cable.maxLengthTiles) return 'cable';
  if (core.clock.money < cable.pricePerLink + cable.pricePerTile * length) return 'money';
  if (freePort(p, a, env) === null || freePort(p, b, env) === null) return 'port';
  return null;
};

// 機器の空いているポートのうち、最も小さい番号を返す
const freePort = (p: Project, node: NetNode, env: Env): number | null => {
  const used = new Set<number>();
  for (const l of p.links) {
    if (l.a.node === node.uid) used.add(l.a.port);
    if (l.b.node === node.uid) used.add(l.b.port);
  }
  const count = env.devices[node.device].portCount;
  for (let port = 0; port < count; port++) if (!used.has(port)) return port;
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

// 2台の機器を配線する。ケーブル費用は配線の長さで決まる。空いているポートを順に使う。
export const connect = (core: Core, aUid: string, bUid: string, cableId: string, env: Env): Outcome => {
  const reason = checkConnect(core, aUid, bUid, cableId, env);
  if (reason) return fail(reason);
  const p = core.active as Project;
  const a = p.nodes.find((n) => n.uid === aUid) as NetNode;
  const b = p.nodes.find((n) => n.uid === bUid) as NetNode;
  const cable = env.cables[cableId];
  const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
  const cost = cable.pricePerLink + cable.pricePerTile * length;
  const portA = freePort(p, a, env) as number;
  const portB = freePort(p, b, env) as number;
  const link: NetLink = {
    uid: `l${p.seq}`,
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
  const next: Project = { ...p, links: [...p.links, link], seq: p.seq + 1, cost: p.cost + cost };
  return {
    ok: true,
    core: { ...withActive(core, next), clock: { ...core.clock, money: core.clock.money - cost } },
  };
};

// 機器の設定を書き換える。配線の設定が固定された機器は変えられない。
const editNode = (core: Core, uid: string, edit: (n: NetNode) => NetNode | string): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  const node = p.nodes.find((n) => n.uid === uid);
  if (!node) return fail('none');
  if (node.configLocked) return fail('locked');
  const result = edit(node);
  if (typeof result === 'string') return fail(result);
  const next: Project = { ...p, nodes: p.nodes.map((n) => (n.uid === uid ? result : n)) };
  return { ok: true, core: withActive(core, next) };
};

// ポートにサブネットの色を塗る。color が null なら色を外す。PC・サーバーはポート0のみ
export const setColor = (core: Core, uid: string, port: number, color: number | null): Outcome =>
  editNode(core, uid, (node) => {
    const colors = { ...(node.colors ?? {}) };
    if (color === null) delete colors[port];
    else colors[port] = color;
    return { ...node, colors };
  });

// 色と配線から生成したネットワーク（判定・表示に使う）
export const compiledNet = (p: Project, env: Env) => compile({ nodes: p.nodes, links: p.links }, env.engine);

// 設計時点の不備（機器の uid -> 不備の種類）
export const designIssues = (p: Project, env: Env): Record<string, Issue> => compiledNet(p, env).issues;

// 施工を依頼する。施工時間は、まだ施工していない機器と配線の分だけかかる。
export const requestBuild = (core: Core, env: Env): Outcome => {
  const p = requireDesign(core);
  if (typeof p === 'string') return fail(p);
  const newNodes = p.nodes.filter((n) => !p.built.nodes.includes(n.uid));
  const newLinks = p.links.filter((l) => !p.built.links.includes(l.uid));
  const total =
    newNodes.length * env.balance.build.minutesPerDevice +
    newLinks.reduce((sum, l) => sum + linkLength(l.path) * env.balance.build.minutesPerCableTile, 0);
  return { ok: true, core: withActive(core, { ...p, phase: 'build', progress: 0, total }) };
};

// 施工を1Tick分進める。勤務時間内のみ、社員が並行して作業する。終わったら検収する。
export const advanceBuild = (core: Core, env: Env, hour: number): Outcome => {
  const p = core.active;
  if (!p || p.phase !== 'build') return { ok: true, core };
  const { workStartHour, workEndHour } = env.balance.build;
  let progress = p.progress;
  if (hour >= workStartHour && hour < workEndHour) {
    progress += env.balance.time.gameMinutesPerTick * env.balance.staff.initialCount * (1 + core.effects.buildSpeed);
  }
  if (progress < p.total) return { ok: true, core: withActive(core, { ...p, progress }) };
  const built = {
    nodes: p.nodes.map((n) => n.uid),
    links: p.links.map((l) => l.uid),
  };
  return inspect(withActive(core, { ...p, progress, built }), env);
};

// 検収: 達成条件を判定する。合格なら納品して報酬と評判を得る。不合格なら設計に戻す。
export const inspect = (core: Core, env: Env): Outcome => {
  const p = core.active;
  if (!p) return fail('none');
  const result = evaluateContract(p.contract, compiledNet(p, env).net, env.engine);
  const traces: Trace[] = result.results.map((r) => ({ kind: r.kind, src: r.src, dst: r.dst, result: r.result }));
  if (result.passed) {
    const stars = rate(p.cost, p.contract.budget, p.rework, env.balance);
    const money = p.contract.reward.money;
    const reputation = core.reputation + p.contract.reward.reputation + stars * env.balance.reputationPerStar;
    // 自社案件は、納品したネットワークを自社オフィスとして残し、効果を加える
    const office = p.contract.inhouse ? { nodes: p.nodes, links: p.links, seq: p.seq } : core.office;
    const effects = { buildSpeed: core.effects.buildSpeed + (p.contract.effect?.buildSpeed ?? 0) };
    return {
      ok: true,
      core: {
        ...core,
        office,
        effects,
        clock: { ...core.clock, money: core.clock.money + money },
        reputation,
        completed: p.kind === 'fixed' ? [...core.completed, p.baseId] : core.completed,
        active: null,
      },
      report: { passed: true, traces, stars, money, reputationGain: reputation - core.reputation, failures: [] },
    };
  }
  const failures: ReportFailure[] = result.results
    .filter((r) => !r.ok && r.failure)
    .map((r) => ({ reason: r.failure!.reason, node: r.failure!.node, goal: r.goal.type }));
  const next: Project = { ...p, rework: p.rework + 1, phase: 'design', progress: 0, total: 0 };
    const hint = p.kind === 'fixed' ? `contract.${p.baseId}.hint` : undefined;
  return { ok: true, core: withActive(core, next), report: { passed: false, traces, failures, hint } };
};

// 受注中の案件を取り消す（施工前のみ）。配置した機器は在庫に戻す。
export const abandon = (core: Core): Outcome => {
  const p = core.active;
  if (!p) return fail('none');
  const inherited = new Set(p.inherited ?? []);
  const builtNew = p.built.nodes.filter((uid) => !inherited.has(uid));
  if (p.phase !== 'design' || builtNew.length > p.contract.placed.length) return fail('locked');
  const owned = { ...core.owned };
  for (const n of p.nodes) if (!n.locked && !inherited.has(n.uid)) owned[n.device] = (owned[n.device] ?? 0) + 1;
  return { ok: true, core: { ...core, owned, active: null } };
};
