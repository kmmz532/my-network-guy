import type { NetworkState } from '../engine/state';
import { effectivePriority, electVrrpMaster } from '../vrrp';

// VRRP の状態（show vrrp に出す）。インターフェースのグループごとに、状態・仮想の IP アドレス・有効な優先度
export interface VrrpStatus {
  iface: string;
  vrid: number;
  ip: string;
  priority: number;
  preempt: boolean;
  state: 'Master' | 'Backup' | 'Init';
  master: string | null;
}
export const vrrpStatusOf = (state: NetworkState, uid: string): VrrpStatus[] => {
  const node = state.addressing.net.nodes.find((n) => n.uid === uid);
  if (!node) return [];
  return node.interfaces.flatMap((i) =>
    (i.vrrp ?? []).map((g) => {
      const members = state.addressing.vrrpMembers(uid, i.port, g.vrid);
      const master = electVrrpMaster(members);
      const me = members.find((m) => m.uid === uid);
      return { iface: i.id, vrid: g.vrid, ip: g.ip, priority: me ? effectivePriority(me) : g.priority, preempt: g.preempt, state: master === uid ? 'Master' : master === null || !me?.up ? 'Init' : 'Backup', master } as VrrpStatus;
    }),
  );
};

// スパニングツリーの計算結果（show spanning-tree に出す）
