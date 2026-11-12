// OSPF の規則（純粋関数）: ルーター ID・隣接の条件・DR/BDR の選出
import { ipToInt } from './engine';
import type { Iface, NetNode } from './types';

export const OSPF_DEFAULT_PRIORITY = 1;
export const OSPF_DEFAULT_HELLO = 10;
export const OSPF_DEFAULT_DEAD = 40;

// ルーター ID。設定があればそれ、なければ、実機と同じく有効なインターフェースの最大のアドレス
// （ループバックは扱わない。OSPF に参加したインターフェースがあれば、その中の最大）
export const ospfRouterId = (node: NetNode): string | null => {
  if (node.ospf?.routerId) return node.ospf.routerId;
  const withIp = node.interfaces.filter((i) => i.ip !== '');
  const joined = withIp.filter((i) => i.ospf !== undefined);
  const pool = joined.length > 0 ? joined : withIp;
  if (pool.length === 0) return null;
  return pool.reduce((best, i) => (ipToInt(i.ip) > ipToInt(best.ip) ? i : best)).ip;
};

export const ospfPriorityOf = (i: Iface): number => i.ospf?.priority ?? OSPF_DEFAULT_PRIORITY;
export const ospfHelloOf = (i: Iface): number => i.ospf?.hello ?? OSPF_DEFAULT_HELLO;
export const ospfDeadOf = (i: Iface): number => i.ospf?.dead ?? OSPF_DEFAULT_DEAD;

// 隣接の条件の食い違い。同じエリア・同じ Hello の間隔・同じデッドの間隔が要る。合えば null
export type OspfMismatch = 'area' | 'hello' | 'dead';
export const ospfMismatch = (a: Iface, b: Iface): OspfMismatch | null => {
  if (a.ospf === undefined || b.ospf === undefined) return 'area';
  if (a.ospf.area !== b.ospf.area) return 'area';
  if (ospfHelloOf(a) !== ospfHelloOf(b)) return 'hello';
  if (ospfDeadOf(a) !== ospfDeadOf(b)) return 'dead';
  return null;
};

export interface DrCandidate {
  uid: string;
  routerId: string;
  priority: number;
}

// DR・BDR の選出。優先度 0 は選ばれない。優先度が大きい順、同じならルーター ID の大きい順。選べる機器が足りなければ null
export const electDr = (members: DrCandidate[]): { dr: string | null; bdr: string | null } => {
  const eligible = members
    .filter((m) => m.priority > 0)
    .sort((a, b) => b.priority - a.priority || ipToInt(b.routerId) - ipToInt(a.routerId));
  return { dr: eligible[0]?.uid ?? null, bdr: eligible[1]?.uid ?? null };
};

// 同じルーター ID を持つ機器の組（ospf.duplicate_router_id）
export const duplicateRouterIds = (nodes: NetNode[]): string[][] => {
  const byId = new Map<string, string[]>();
  for (const n of nodes) {
    if (!n.interfaces.some((i) => i.ospf !== undefined)) continue;
    const id = ospfRouterId(n);
    if (id !== null) byId.set(id, [...(byId.get(id) ?? []), n.uid]);
  }
  return [...byId.values()].filter((uids) => uids.length > 1);
};
