// 機器が動的経路（RIP・OSPF）で覚えた経路（show ip rip database・show ip route に使う）
import type { NetworkState } from '../engine/state';
import type { Route } from '../types';

export const learnedRoutesOf = (state: NetworkState, uid: string, protocol: 'rip' | 'ospf' | 'bgp'): Route[] =>
  state.routing.routesOf(uid).filter((r) => r.protocol === protocol);
