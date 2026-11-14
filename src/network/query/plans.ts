// アドレスの計画を L2 ドメインで引く（画面のネットワークの設定・操作・ゲートウェイの候補に使う）
import { ipToInt } from '../engine';
import { isRoutingCategory } from '../category';
import { networkAddress, planFor } from '../segments';
import type { DomainKey, Endpoint, NetworkPlan } from '../types';
import type { PlanDomain } from '../engine/stages/l2';
import type { NetworkState } from '../engine/state';
import { deviceCategory } from '../../registry/query';

const same = (a: Endpoint, b: Endpoint): boolean => a.node === b.node && a.port === b.port;

// 端点が属する計画の単位の L2 ドメイン（無線の端末は、つながるアクセスポイントのドメイン）。配線がなければ undefined
export const planDomainOf = (state: NetworkState, endpoint: Endpoint): PlanDomain | undefined =>
  state.l2.planDomains.find((d) => d.members.some((m) => same(m, endpoint)) || d.wireless.some((m) => same(m, endpoint)));

// 端点の L2 ドメインの計画
export const planOf = (state: NetworkState, endpoint: Endpoint): NetworkPlan | undefined => {
  const domain = planDomainOf(state, endpoint);
  return domain ? planFor(domain, new Map(state.input.nodes.map((n) => [n.uid, n])), state.input.plans) : undefined;
};

// 計画のない L2 ドメインに、IPアドレスのある機器から計画を作る（そのドメインで最も小さい機器のアドレスのネットワーク）。
// 保存された計画は残す。配線の後にIPアドレスを入力したときや、配線を外して分かれたときに使う
export const fillPlans = (state: NetworkState): Record<DomainKey, NetworkPlan> => {
  const nodes = new Map(state.input.nodes.map((n) => [n.uid, n]));
  const out: Record<DomainKey, NetworkPlan> = { ...(state.input.plans ?? {}) };
  for (const domain of state.l2.planDomains) {
    if (planFor(domain, nodes, out)) continue;
    for (const m of domain.members) {
      const iface = nodes.get(m.node)?.interfaces.find((i) => i.port === m.port);
      if (iface) {
        out[domain.key] = { network: networkAddress(iface.ip, iface.prefix), prefix: iface.prefix };
        break;
      }
    }
  }
  return out;
};

// 端点の中のルーターの口のアドレス（自分の機器を除き、昇順）。DHCP の割り当ての後のアドレスを使う
const routerIpsOf = (state: NetworkState, members: Endpoint[], self: string): string[] => {
  const byUid = new Map(state.net.nodes.map((n) => [n.uid, n]));
  const ips = new Set<string>();
  for (const m of members) {
    if (m.node === self) continue;
    const node = byUid.get(m.node);
    if (!node || !isRoutingCategory(deviceCategory(node.device))) continue;
    const iface = node.interfaces.find((i) => i.port === m.port);
    if (iface) ips.add(iface.ip);
  }
  return [...ips].sort((a, b) => ipToInt(a) - ipToInt(b));
};

// 機器の口と同じ L2 ドメインにあるルーターのアドレス。ホストのデフォルトゲートウェイの候補に使う
export const routerAddressesOn = (state: NetworkState, uid: string, port: number): string[] => {
  const domain = planDomainOf(state, { node: uid, port });
  return domain ? routerIpsOf(state, domain.members, uid) : [];
};

// ホストのデフォルトゲートウェイとして指定できるアドレス: 同じ L2 ドメインのルーターの口のアドレスと、その口の VRRP の仮想 IP
export const gatewayCandidatesOn = (state: NetworkState, uid: string, port: number): string[] => {
  const domain = planDomainOf(state, { node: uid, port });
  if (!domain) return [];
  const byUid = new Map(state.input.nodes.map((n) => [n.uid, n]));
  const virtual = new Set<string>();
  for (const m of domain.members) {
    const node = byUid.get(m.node);
    if (!node || !isRoutingCategory(deviceCategory(node.device))) continue;
    for (const g of node.interfaces.find((i) => i.port === m.port)?.vrrp ?? []) virtual.add(g.ip);
  }
  return [...new Set([...routerIpsOf(state, domain.members, uid), ...virtual])].sort((a, b) => ipToInt(a) - ipToInt(b));
};

// 機器がつながる L2 ドメインにあるルーターのアドレス（自分を除く）。静的ルートのネクストホップの候補に使う
export const neighborRouterAddresses = (state: NetworkState, uid: string): string[] =>
  routerIpsOf(
    state,
    state.l2.planDomains.filter((d) => d.members.some((m) => m.node === uid) || d.wireless.some((m) => m.node === uid)).flatMap((d) => d.members),
    uid,
  );
