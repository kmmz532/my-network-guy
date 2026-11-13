import type { NetworkState } from '../engine/state';
import type { Iface, NetNode } from '../types';
import { ospfPeersOf } from '../netState';
import { electDr, ospfPriorityOf, ospfRouterId, type DrCandidate } from '../ospf';

export interface OspfNeighbor {
  uid: string;
  ip: string;
  port: number;
  neighborIp: string;
  routerId: string;
  priority: number;
  // 実機の State の欄: FULL/DR・FULL/BDR・FULL/DROTHER・2-WAY/DROTHER・FULL/-（2台だけのネットワーク）
  state: string;
}

// OSPF の隣接（show ip ospf neighbor に出す）。同じエリア・同じ Hello とデッドの間隔で、同じサブネットの、OSPF に参加した相手のルーターの口。
// 同じネットワークにルーターが3台以上あるときは、DR・BDR を選び、State に出す
export const ospfNeighborsOf = (state: NetworkState, uid: string): OspfNeighbor[] => {
  const topo = state.topology;
  const r = topo.node(uid);
  if (!r) return [];
  const peers = ospfPeersOf(topo, uid).filter((p) => p.mismatch === null);
  const candidate = (nodeUid: string, port: number): DrCandidate => {
    const n = topo.node(nodeUid) as NetNode;
    const iface = n.interfaces.find((x) => x.port === port) as Iface;
    return { uid: nodeUid, routerId: ospfRouterId(n) ?? iface.ip, priority: ospfPriorityOf(iface) };
  };
  return peers.map((p) => {
    // このインターフェースのネットワーク（同じ口で隣接した相手と自分）
    const onSegment = peers.filter((q) => q.port === p.port);
    const members = [candidate(uid, p.port), ...onSegment.map((q) => candidate(q.uid, topo.node(q.uid)!.interfaces.find((x) => x.ip === q.neighborIp)!.port))];
    const peer = candidate(p.uid, topo.node(p.uid)!.interfaces.find((x) => x.ip === p.neighborIp)!.port);
    let state = 'FULL/-';
    if (members.length >= 3) {
      const { dr, bdr } = electDr(members);
      if (p.uid === dr) state = 'FULL/DR';
      else if (p.uid === bdr) state = 'FULL/BDR';
      else state = uid === dr || uid === bdr ? 'FULL/DROTHER' : '2-WAY/DROTHER';
    }
    return { uid: p.uid, ip: p.ip, port: p.port, neighborIp: p.neighborIp, routerId: peer.routerId, priority: peer.priority, state };
  });
};

