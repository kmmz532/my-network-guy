import type { NetworkState } from '../engine/state';
import { macOf } from '../mac';
import { deviceCategory } from '../../registry/query';

// スイッチの MAC の表（show mac address-table）: 口ごとに、同じ L2 のドメインにつながった端末の MAC（段2の計算の結果。ping の学習ではない・NET.md §5.10）
export const macTableOf = (state: NetworkState, uid: string): { port: number; mac: string }[] => {
  const topo = state.topology;
  const self = topo.node(uid);
  if (!self) return [];
  const out: { port: number; mac: string }[] = [];
  for (const port of [...new Set(state.net.links.filter((l) => l.a.node === uid || l.b.node === uid).map((l) => (l.a.node === uid ? l.a.port : l.b.port)))].sort((a, b) => a - b)) {
    for (const m of topo.domainOf({ node: uid, port }).members) {
      if (m.node === uid) continue;
      const other = topo.node(m.node);
      if (!other || other.macSerial === undefined || topo.isRouter(other.uid)) continue;
      out.push({ port, mac: macOf(deviceCategory(other.device), other.macSerial, m.port) });
    }
  }
  return out;
};

