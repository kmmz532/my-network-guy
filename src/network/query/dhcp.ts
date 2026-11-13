// DHCP の割り当て（show ip dhcp binding・警告・達成条件に使う）
import type { NetworkState } from '../engine/state';
import type { DhcpResult } from '../dhcp';

export const dhcpOf = (state: NetworkState): DhcpResult => state.dhcp;
