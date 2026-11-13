// 隣接にならなかった候補と、その理由（show ip ospf neighbor が空のときの説明に使う）
import type { NetworkState } from '../engine/state';
import { ospfPeersOf, type OspfPeer } from '../netState';

export const ospfMismatchesOf = (state: NetworkState, uid: string): OspfPeer[] =>
  ospfPeersOf(state.topology, uid).filter((p) => p.mismatch !== null);
