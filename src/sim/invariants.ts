// 守るべき規則（不変条件）を確かめる（N120）。破れている箇所を文字列の一覧で返す（空なら守られている）。
// 規則の一覧は memo/TASK.md の N120 を正とする。ここでは、操作の試験（invariants.test.ts）で確かめる規則だけを書く。
import type { Core, Env, Project } from './project';
import type { NetLink, NetNode } from '../network/types';
import { isBackOffice } from './backOffice';

type Net = { nodes: readonly NetNode[]; links: readonly NetLink[] };

// 1つのネットワーク（自社オフィス・案件）の規則
const netViolations = (name: string, net: Net, env: Env): string[] => {
  const out: string[] = [];
  const uids = new Set(net.nodes.map((n) => n.uid));
  if (uids.size !== net.nodes.length) out.push(`${name}: 機器の uid が重なる`);
  const linkUids = new Set(net.links.map((l) => l.uid));
  if (linkUids.size !== net.links.length) out.push(`${name}: 配線の uid が重なる`);
  // 両端の機器が存在し、ポートの番号が機器の範囲にある
  const used = new Set<string>();
  for (const l of net.links) {
    for (const end of [l.a, l.b]) {
      if (!uids.has(end.node)) out.push(`${name}: 配線 ${l.uid} の機器 ${end.node} がない`);
      const node = net.nodes.find((n) => n.uid === end.node);
      const count = node ? env.devices[node.device]?.portCount ?? 0 : 0;
      if (node && (end.port < 0 || end.port >= count)) out.push(`${name}: 配線 ${l.uid} のポート ${end.port} が範囲外`);
      // 1つのポートに挿さるケーブルは1本まで
      const key = `${end.node}:${end.port}`;
      if (used.has(key)) out.push(`${name}: ポート ${key} に2本のケーブル`);
      used.add(key);
    }
    // 払った額は負にならない（撤去で戻る額は払った額を超えない）
    if (!(l.paid >= 0)) out.push(`${name}: 配線 ${l.uid} の払った額が負（${l.paid}）`);
  }
  return out;
};

// 全体の規則。自社オフィス・案件・担当・資金・見ている場所
export const checkInvariants = (core: Core, env: Env): string[] => {
  const out = netViolations('自社オフィス', core.office, env);
  if (core.clock.money < 0) out.push(`資金が負（${core.clock.money}）`);
  const ids = new Set<string>();
  const crewSeen = new Map<string, string>();
  for (const p of core.active as Project[]) {
    ids.add(p.id);
    out.push(...netViolations(`案件 ${p.id}`, p, env));
    for (const uid of p.crew) {
      const member = core.staff.find((s) => s.uid === uid);
      if (!member) out.push(`案件 ${p.id} の担当 ${uid} がいない`);
      else if (isBackOffice(member.job)) out.push(`案件 ${p.id} の担当 ${uid} が内勤`);
      const other = crewSeen.get(uid);
      if (other !== undefined && other !== p.id) out.push(`担当 ${uid} が案件 ${other} と ${p.id} の両方にいる`);
      crewSeen.set(uid, p.id);
    }
  }
  // 見ている案件は、進行中の案件か自社オフィス（null）
  if (core.focus !== null && !ids.has(core.focus)) out.push(`見ている案件 ${core.focus} が進行中でない`);
  return out;
};
