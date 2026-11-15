// 能力を要する編集の判定。能力と、能力のない機器への拒否の理由を、この表の1か所で決める
import type { Capability } from '../data/schema';
import { can } from '../network/capabilities';
import type { OpFailReason } from './failReason';

export const CAPABILITY_REFUSALS = {
  svi: 'svi.none',
  switchport: 'port.mode',
  routedPort: 'port.mode',
  stp: 'port.mode',
  vrrp: 'vrrp.unsupported',
  dhcpRelay: 'dhcp.unsupported',
  services: 'dhcp.unsupported',
  lag: 'lag.unsupported',
  wireless: 'none',
  nat: 'none',
  bgp: 'none',
  firewall: 'none',
} as const satisfies Partial<Record<Capability, OpFailReason>>;

export type GatedCapability = keyof typeof CAPABILITY_REFUSALS;

// 機器が能力を持たなければ拒否の理由を、持てば null を返す
export const refusalFor = (device: string, capability: GatedCapability): OpFailReason | null =>
  can(device, capability) ? null : CAPABILITY_REFUSALS[capability];
