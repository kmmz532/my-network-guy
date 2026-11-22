// 自社の実績。自社オフィスのネットワークで、ある論点の構成が動いていれば、その論点を実績にする。
// 条件は、依頼の達成条件（evaluateGoal）を自社オフィスの構成に当てて判定する。月末に判定する。
import type { Goal } from '../data/schema';
import { analyze } from '../network/engine/analyze';
import type { NetworkState } from '../network/engine/state';
import { evaluateGoal } from '../network/goals';
import { isPcCategory } from '../data/categories';
import { deviceCategory } from '../registry/query';
import { engineWithSite } from './walls';
import type { Env, Office } from './project';

// 実績の論点。goalTypes は、その論点を学ぶ定型案件を見分ける達成条件の型（提案の依頼の対象）
export const ACHIEVEMENTS = [
  { id: 'dmz', goalTypes: ['public_http'] },
  { id: 'vlan_isolation', goalTypes: ['isolated'] },
  { id: 'redundancy', goalTypes: ['survive_link_failure'] },
] as const satisfies readonly { id: string; goalTypes: readonly Goal['type'][] }[];

export type AchievementId = (typeof ACHIEVEMENTS)[number]['id'];

const PUBLIC_PORT = 80;

const passes = (goal: Goal, state: NetworkState): boolean => {
  const rs = evaluateGoal(goal, state);
  return rs.length > 0 && rs.every((r) => r.ok);
};

// 公開のサーバーに外から HTTP が届き、社内の PC には外から届かない
const dmzHolds = (state: NetworkState): boolean => {
  const nodes = state.net.nodes;
  const servers = nodes.filter((n) => deviceCategory(n.device) === 'server');
  const pcs = nodes.filter((n) => isPcCategory(deviceCategory(n.device)));
  if (servers.length === 0 || pcs.length === 0) return false;
  const published = servers.some((s) => passes({ type: 'public_http', to: s.uid, port: PUBLIC_PORT }, state));
  return published && pcs.every((p) => !passes({ type: 'public_http', to: p.uid, port: PUBLIC_PORT }, state));
};

// 配線のつながった PC が2つ以上の VLAN に分かれ、VLAN の間が isolated
const vlanIsolationHolds = (state: NetworkState): boolean => {
  const byVlan = new Map<number, string[]>();
  for (const n of state.net.nodes) {
    if (!isPcCategory(deviceCategory(n.device))) continue;
    const link = state.net.links.find((l) => l.a.node === n.uid || l.b.node === n.uid);
    if (!link) continue;
    const peer = link.a.node === n.uid ? link.b : link.a;
    const vlan = state.l2.vlanOf(peer.node, peer.port);
    byVlan.set(vlan, [...(byVlan.get(vlan) ?? []), n.uid]);
  }
  const groups = [...byVlan.values()];
  if (groups.length < 2) return false;
  for (let i = 0; i < groups.length; i++) for (let j = i + 1; j < groups.length; j++) if (!passes({ type: 'isolated', from: groups[i], to: groups[j] }, state)) return false;
  return true;
};

// 機器どうし（PC・サーバー以外）の配線のどれか1組を外しても、PC・サーバーの間が届く
const redundancyHolds = (state: NetworkState): boolean => {
  const isEnd = (uid: string): boolean => {
    const n = state.net.nodes.find((x) => x.uid === uid);
    if (!n) throw new Error(`配線の端の機器がない: ${uid}`);
    const c = deviceCategory(n.device);
    return isPcCategory(c) || c === 'server';
  };
  const links: [string, string][] = [];
  for (const l of state.net.links) {
    if (isEnd(l.a.node) || isEnd(l.b.node)) continue;
    if (!links.some(([a, b]) => (a === l.a.node && b === l.b.node) || (a === l.b.node && b === l.a.node))) links.push([l.a.node, l.b.node]);
  }
  return links.length > 0 && passes({ type: 'survive_link_failure', links }, state);
};

const HOLDS: Record<AchievementId, (state: NetworkState) => boolean> = {
  dmz: dmzHolds,
  vlan_isolation: vlanIsolationHolds,
  redundancy: redundancyHolds,
};

// 自社オフィスの構成が満たしている実績（ACHIEVEMENTS の順）
export const achievedOf = (office: Office, env: Env): AchievementId[] => {
  const state = analyze({ nodes: office.nodes, links: office.links, plans: office.plans }, engineWithSite(env.engine, undefined, office.furniture));
  return ACHIEVEMENTS.filter((a) => HOLDS[a.id](state)).map((a) => a.id);
};

// 月末の判定の結果。今ある実績・新しく付いた実績・外れた実績
export interface AchievementSettle {
  list: string[];
  gained: string[];
  lost: string[];
}

export const settleAchievements = (prev: readonly string[], now: readonly AchievementId[]): AchievementSettle => ({
  list: [...now],
  gained: now.filter((id) => !prev.includes(id)),
  lost: prev.filter((id) => !(now as readonly string[]).includes(id)),
});

// 定型案件の達成条件の型が学ぶ、実績のある論点（なければ null）
export const proposalTopicOf = (goals: readonly Goal[], achieved: readonly string[]): string | null =>
  ACHIEVEMENTS.find((a) => achieved.includes(a.id) && goals.some((g) => (a.goalTypes as readonly string[]).includes(g.type)))?.id ?? null;
