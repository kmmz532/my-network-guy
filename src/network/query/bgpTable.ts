// BGP の計算結果（show ip bgp・show ip bgp summary に出す）。BGP を動かしていない機器は undefined
import type { BgpResult } from '../bgp';
import type { NetworkState } from '../engine/state';

export const bgpTableOf = (state: NetworkState, uid: string): BgpResult | undefined => state.routing.bgpOf(uid);
