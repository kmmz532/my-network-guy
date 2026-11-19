// 演習（学習モード）の問いの判定。画面・ストアに依存しない純粋関数。
// 正解はデータに書かず、構成から計算の結果（NetworkState）で求める。候補も構成から集める。
import type { Change, Drill, Flow, InspectAsk, Question } from '../data/schema';
import { applyConfig } from '../company/apply';
import { isL2Category, isRoutingCategory } from '../network/category';
import { analyze } from '../network/engine/analyze';
import type { NetworkState } from '../network/engine/state';
import { adOf } from '../network/engine/stages/routing';
import { deliver, http, ping } from '../network/engine/forward';
import { framesOf, type FrameContext } from '../network/frames';
import { networkAddress } from '../network/segments';
import { electDr, ospfPriorityOf, ospfRouterId, type DrCandidate } from '../network/ospf';
import { neighborRouterAddresses } from '../network/query/plans';
import { stpOf } from '../network/query/stp';
import { vrrpStatusOf } from '../network/query/vrrpStatus';
import { FAILURE_REASONS, type EngineData, type FailureReason, type NetLink, type NetNode, type PathResult, type Route } from '../network/types';
import { deviceCategory } from '../registry/query';
import { lessonGoalResults, lessonLinks, lessonNodes } from './lesson';
import { emptyOffice, type Core, type Env } from './project';

// 演習の構成（機器と配線）
export interface DrillConfig {
  nodes: NetNode[];
  links: NetLink[];
}

// 演習の初期の構成
export const drillConfig = (drill: Pick<Drill, 'id' | 'placed' | 'links'>): DrillConfig => ({ nodes: lessonNodes(drill), links: lessonLinks(drill) });

export const drillState = (config: DrillConfig, engine: EngineData): NetworkState => analyze({ nodes: config.nodes, links: config.links, plans: {} }, engine);

// 問いの前の構成の変更（setup の before がその問いの id のもの）を、netEdit の編集の関数を通して当てる。失敗は例外
export const applySetup = (drill: Pick<Drill, 'id' | 'questions' | 'setup'>, questionId: string, config: DrillConfig, env: Env): DrillConfig => {
  if (!drill.questions.some((q) => q.id === questionId)) throw new Error(`演習 ${drill.id}: 問い ${questionId} がない`);
  const changes: Change[] = (drill.setup ?? []).filter((s) => s.before === questionId).flatMap((s) => s.change);
  // 編集の関数は構成を持つ状態（Core）を取る。構成だけを持つ最小の状態に載せて当てる
  let core = { active: [], focus: null, office: { ...emptyOffice(env.balance.office.initialSize), nodes: config.nodes, links: config.links } } as unknown as Core;
  for (const c of changes) {
    const r = applyConfig(core, c.uid, c.change, { env, target: 'office' });
    if (!r.ok) throw new Error(`演習 ${drill.id}: 問い ${questionId} の前の設定の変更に失敗した（${c.uid} ${c.change.kind}: ${r.reason}）`);
    core = r.core;
  }
  return { nodes: core.office.nodes, links: core.office.links };
};

const parsePrefix = (text: string): { dest: string; prefix: number } => {
  const [dest, len] = text.split('/');
  return { dest, prefix: Number(len) };
};

const nodeOf = (state: NetworkState, uid: string): NetNode => {
  const node = state.addressing.nodeOf(uid);
  if (!node) throw new Error(`演習: 機器 ${uid} がない`);
  return node;
};

// 宛先のネットワークへの、使われる経路（直結 → 管理距離の小さい順 → メトリックの小さい順）
const bestRoute = (state: NetworkState, uid: string, text: string): { connected: boolean; route: Route | null } => {
  const node = nodeOf(state, uid);
  const { dest, prefix } = parsePrefix(text);
  if (node.interfaces.some((i) => i.prefix === prefix && networkAddress(i.ip, i.prefix) === dest)) return { connected: true, route: null };
  const gateway: Route[] = prefix === 0 && node.gateway ? [{ dest: '0.0.0.0', prefix: 0, nextHop: node.gateway, protocol: 'static' }] : [];
  const routes = [...state.routing.routesOf(uid), ...gateway].filter((r) => r.dest === dest && r.prefix === prefix);
  if (routes.length === 0) throw new Error(`演習: ${uid} に ${text} の経路がない`);
  const route = routes.reduce((best, r) => (adOf(r) < adOf(best) || (adOf(r) === adOf(best) && (r.metric ?? 0) < (best.metric ?? 0)) ? r : best));
  return { connected: false, route };
};

const ROUTE_SOURCES = ['C', 'S', 'R', 'O', 'O IA', 'B'] as const;
const sourceOf = (route: Route | null): (typeof ROUTE_SOURCES)[number] => {
  if (route === null) return 'C';
  switch (route.protocol) {
    case undefined:
    case 'static': return 'S';
    case 'rip': return 'R';
    case 'ospf': return route.interArea ? 'O IA' : 'O';
    case 'bgp': return 'B';
  }
};

// OSPF のネットワーク（segment）に口を持つルーター。DR の選出の候補
const ospfMembers = (state: NetworkState, segment: string): DrCandidate[] => {
  const { dest, prefix } = parsePrefix(segment);
  return state.addressing.net.nodes.flatMap((n) =>
    n.interfaces.filter((i) => i.ospf !== undefined && i.prefix === prefix && networkAddress(i.ip, i.prefix) === dest).map((i) => ({ uid: n.uid, routerId: ospfRouterId(n) ?? i.ip, priority: ospfPriorityOf(i) })),
  );
};

const vrrpNodes = (state: NetworkState, vrid: number): string[] => state.addressing.net.nodes.filter((n) => n.interfaces.some((i) => (i.vrrp ?? []).some((g) => g.vrid === vrid))).map((n) => n.uid);

const frameCtx = (state: NetworkState): FrameContext => {
  const category = (uid: string) => deviceCategory(nodeOf(state, uid).device);
  return { nodes: state.net.nodes, links: state.net.links, categoryOf: deviceCategory, isSwitch: (uid) => isL2Category(category(uid)), isRouter: (uid) => isRoutingCategory(category(uid)) };
};

const framesOfPing = (state: NetworkState, from: string, to: string) => {
  const result = ping(state, from, to);
  if (!result.ok) throw new Error(`演習: ${from} から ${to} へ届かないため、フレームを求められない`);
  return framesOf(frameCtx(state), result);
};

type Frames = ReturnType<typeof framesOfPing>;
type FrameField = Extract<InspectAsk, { what: 'frame_field' }>['field'];
const vlanText = (vlan: number | null): string => (vlan === null ? 'untagged' : String(vlan));
const frameValue = (f: Frames[number], field: FrameField): string => {
  switch (field) {
    case 'srcMac': return f.l2.srcMac;
    case 'dstMac': return f.l2.dstMac;
    case 'srcIp': return f.l3.srcIp;
    case 'ttl': return String(f.l3.ttl);
    case 'vlan': return vlanText(f.l2.vlan);
  }
};

const unique = (values: string[]): string[] => [...new Set(values)].sort();

// 調べて答える問いの正解（今の構成から求める。答えは文字列）
export const inspectAnswer = (state: NetworkState, ask: InspectAsk): string => {
  switch (ask.what) {
    case 'next_hop': {
      const { connected, route } = bestRoute(state, ask.node, ask.prefix);
      if (connected || route === null) throw new Error(`演習: ${ask.node} の ${ask.prefix} は直結で、次のホップがない`);
      return route.nextHop;
    }
    case 'route_source':
      return sourceOf(bestRoute(state, ask.node, ask.prefix).route);
    case 'ospf_dr': {
      const members = ospfMembers(state, ask.segment);
      if (members.length < 2) throw new Error(`演習: ${ask.segment} の OSPF のルーターが2台未満`);
      const { dr } = electDr(members);
      if (dr === null) throw new Error(`演習: ${ask.segment} の DR を選べない`);
      return dr;
    }
    case 'stp_root': {
      const { root } = stpOf(state);
      if (root === null) throw new Error('演習: スパニングツリーのスイッチがない');
      return root;
    }
    case 'vrrp_master': {
      const masters = unique(vrrpNodes(state, ask.vrid).flatMap((uid) => vrrpStatusOf(state, uid).filter((s) => s.vrid === ask.vrid).map((s) => s.master ?? '')));
      if (masters.length !== 1 || masters[0] === '') throw new Error(`演習: VRID ${ask.vrid} のマスターが1台に定まらない`);
      return masters[0];
    }
    case 'bgp_best': {
      const { dest, prefix } = parsePrefix(ask.prefix);
      const best = state.routing.bgpOf(ask.node)?.candidates.find((c) => c.dest === dest && c.prefix === prefix && c.best);
      if (!best || best.path.length === 0) throw new Error(`演習: ${ask.node} に ${ask.prefix} の学んだ最適経路がない`);
      return best.path.join(' ');
    }
    case 'frame_field': {
      const frame = framesOfPing(state, ask.from, ask.to)[ask.hop];
      if (!frame) throw new Error(`演習: ${ask.from} から ${ask.to} のフレームに ${ask.hop} 番がない`);
      return frameValue(frame, ask.field);
    }
  }
};

// 調べて答える問いの候補。同じ種類の値を構成から集める（正解を含む。含まなければ例外）
export const inspectChoices = (state: NetworkState, ask: InspectAsk): string[] => {
  const answer = inspectAnswer(state, ask);
  let values: string[];
  switch (ask.what) {
    case 'next_hop':
      values = neighborRouterAddresses(state, ask.node);
      break;
    case 'route_source':
      values = [...ROUTE_SOURCES];
      break;
    case 'ospf_dr':
      values = ospfMembers(state, ask.segment).map((m) => m.uid);
      break;
    case 'stp_root':
      values = [...stpOf(state).rootCost.keys()];
      break;
    case 'vrrp_master':
      values = vrrpNodes(state, ask.vrid);
      break;
    case 'bgp_best':
      values = (state.routing.bgpOf(ask.node)?.candidates ?? []).filter((c) => c.path.length > 0).map((c) => c.path.join(' '));
      break;
    case 'frame_field': {
      const frames = framesOfPing(state, ask.from, ask.to);
      const same = (f: Frames[number]): string[] => {
        switch (ask.field) {
          case 'srcMac':
          case 'dstMac': return [f.l2.srcMac, f.l2.dstMac];
          case 'srcIp': return [f.l3.srcIp, f.l3.dstIp];
          case 'ttl': return [String(f.l3.ttl)];
          case 'vlan': return [vlanText(f.l2.vlan)];
        }
      };
      // VLAN は、構成の口に設定された VLAN も候補にする
      const portVlans = ask.field === 'vlan' ? state.net.nodes.flatMap((n) => n.ports.flatMap((p) => [p.vlan, p.native, ...(p.allowed ?? [])]).filter((v): v is number => v !== undefined).map(String)) : [];
      values = [...frames.flatMap(same), ...portVlans];
      break;
    }
  }
  const choices = unique(values);
  if (!choices.includes(answer)) throw new Error(`演習: 候補に正解 ${answer} が含まれない（${ask.what}）`);
  return choices;
};

export const judgeInspect = (state: NetworkState, ask: InspectAsk, answer: string): boolean => inspectAnswer(state, ask) === answer;

// 原因を選ぶ問いの失敗（段5の失敗）。届くときは、直す対象がないため例外
const diagnoseResult = (state: NetworkState, q: Extract<Question, { kind: 'diagnose' }>): PathResult =>
  q.traffic.kind === 'ping' ? ping(state, q.from, q.to, { size: q.traffic.size, df: q.traffic.df }) : q.traffic.kind === 'http' ? http(state, q.from, q.to, q.traffic.port) : deliver(state, q.from, q.to, { kind: 'dns' });

// 原因を選ぶ問いの通信が、今の構成で届くか（直した後の合否）
export const diagnoseReaches = (state: NetworkState, q: Extract<Question, { kind: 'diagnose' }>): boolean => diagnoseResult(state, q).ok;

const diagnoseFailure = (state: NetworkState, q: Extract<Question, { kind: 'diagnose' }>): NonNullable<PathResult['failure']> => {
  const result = diagnoseResult(state, q);
  if (result.ok || !result.failure) throw new Error(`演習: 問い ${q.id} の通信は届くため、原因がない`);
  return result.failure;
};

// 原因の候補: 構成の機器すべてと、失敗の理由すべて
export const diagnoseChoices = (state: NetworkState): { nodes: string[]; reasons: readonly FailureReason[] } => ({ nodes: state.net.nodes.map((n) => n.uid), reasons: FAILURE_REASONS });

// 原因の問いが出す理由の候補。正解と、問いの id から決まる並びの先頭の数件（仮の絞り方）。FAILURE_REASONS の順に並べる
export const DIAGNOSE_REASON_COUNT = 6;
const seeded = (text: string): number => [...text].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
export const diagnoseReasonChoices = (state: NetworkState, q: Extract<Question, { kind: 'diagnose' }>): FailureReason[] => {
  const correct = diagnoseFailure(state, q).reason;
  const others = FAILURE_REASONS.filter((r) => r !== correct)
    .map((r) => ({ r, k: seeded(`${q.id}:${r}`) }))
    .sort((a, b) => a.k - b.k || a.r.localeCompare(b.r))
    .slice(0, DIAGNOSE_REASON_COUNT - 1)
    .map((x) => x.r);
  const picked = new Set<FailureReason>([correct, ...others]);
  return FAILURE_REASONS.filter((r) => picked.has(r));
};

// 原因の問いの正解（機器と理由）
export const diagnoseAnswer = (state: NetworkState, q: Extract<Question, { kind: 'diagnose' }>): { node: string; reason: FailureReason } => {
  const { node, reason } = diagnoseFailure(state, q);
  return { node, reason };
};

// 選んだ機器と理由が、段5の失敗の機器と理由に一致するか
export const judgeDiagnose = (state: NetworkState, q: Extract<Question, { kind: 'diagnose' }>, answer: { node: string; reason: FailureReason }): boolean => {
  const failure = diagnoseFailure(state, q);
  return failure.node === answer.node && failure.reason === answer.reason;
};

// 設定する問い: 達成条件がすべて満たされているか
export const judgeBuild = (q: Extract<Question, { kind: 'build' }>, config: DrillConfig, engine: EngineData, flows?: readonly Flow[]): boolean => lessonGoalResults(q.goals, config.nodes, config.links, engine, flows).every(Boolean);
