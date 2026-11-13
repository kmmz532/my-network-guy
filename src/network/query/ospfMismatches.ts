// 隣接にならなかった候補と、その理由（show ip ospf neighbor が空のときの説明に使う）
import type { NetworkState } from '../engine/state';
import type { OspfPeer } from '../engine/stages/routing';

export const ospfMismatchesOf = (state: NetworkState, uid: string): OspfPeer[] =>
  state.routing.ospfPeersOf(uid).filter((p) => p.mismatch !== null);
