// アドレスの計画の計算（ネットワークアドレス・収容できる台数）と、L2 ドメインの計画の参照。
// 計画は L2 ドメインの鍵（ドメインの中で配線でつながった最も小さい機器の uid と口、"uid:port"）で持つ
import { ipToInt } from './engine';
import type { DomainKey, NetNode, NetworkPlan } from './types';
import type { PlanDomain } from './engine/stages/l2';

// 設定できるプレフィックス長（sim-3 の候補）
export const PREFIX_MIN = 24;
export const PREFIX_MAX = 30;

export const epKey = (node: string, port: number): string => `${node}:${port}`;

const maskOf = (prefix: number): number => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

export const intToIp = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

// IPアドレスとプレフィックス長から、ネットワークアドレスを求める
export const networkAddress = (ip: string, prefix: number): string => intToIp((ipToInt(ip) & maskOf(prefix)) >>> 0);

// ホストに割り当てられるアドレスの数（ネットワークアドレスとブロードキャストアドレスを除く）
export const hostCapacity = (prefix: number): number => Math.max(0, 2 ** (32 - prefix) - 2);

// L2 ドメインの計画。案件で設定が固定された機器（配線の設定が固定された機器）を含むときは、その機器のアドレスから決める。
// そのほかは保存された計画を使う
export const planFor = (
  domain: Pick<PlanDomain, 'key' | 'members'>,
  nodes: Map<string, NetNode>,
  plans?: Record<DomainKey, NetworkPlan>,
): NetworkPlan | undefined => {
  for (const m of domain.members) {
    const node = nodes.get(m.node);
    if (!node?.configLocked) continue;
    const iface = node.interfaces.find((i) => i.port === m.port);
    if (iface) return { network: networkAddress(iface.ip, iface.prefix), prefix: iface.prefix };
  }
  return plans?.[domain.key];
};
