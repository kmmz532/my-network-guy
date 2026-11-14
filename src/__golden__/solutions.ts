// 教材ごとの正解の設定（教材のデータには入れない）。教材の試験と、挙動の記録の試験が同じものを使う
import type { NetNode } from '../network/types';

type Solve = (nodes: NetNode[]) => NetNode[];

const on = (uids: string[], f: (n: NetNode) => NetNode): Solve => (nodes) => nodes.map((n) => (uids.includes(n.uid) ? f(n) : n));
const ifaces = (n: NetNode, f: (i: NetNode['interfaces'][number]) => NetNode['interfaces'][number]): NetNode => ({ ...n, interfaces: n.interfaces.map(f) });

export const solutions: Record<string, Solve> = {
  ospf_three_sites: on(['R1', 'R2', 'R3'], (n) => ifaces(n, (i) => ({ ...i, ospf: { area: 0 } }))),
  ospf_intro: on(['R1', 'R2'], (n) => ifaces(n, (i) => ({ ...i, ospf: { area: 0 } }))),
  bgp_two_isps: on(['R1'], (n) => ({ ...n, bgp: { asn: 64512, neighbors: [{ ip: '198.51.100.1', remoteAs: 65001 }, { ip: '203.0.113.1', remoteAs: 65002 }], networks: [] } })),
  vlan_two_floors: on(['SW1', 'SW2'], (n) => ({
    ...n,
    ports: [{ port: 0, mode: 'access' as const, vlan: 10 }, { port: 1, mode: 'access' as const, vlan: 20 }, { port: 7, mode: 'trunk' as const, allowed: [10, 20] }],
  })),
  vrrp_pair: on(['R1', 'R2'], (n) =>
    ifaces(n, (i) => ({ ...i, vrrp: [{ vrid: i.port === 0 ? 1 : 2, ip: i.port === 0 ? '192.168.1.254' : '10.0.9.254', priority: n.uid === 'R1' ? 110 : 100, preempt: true }] })),
  ),
  stp_triangle: on(['SW2'], (n) => ({ ...n, stpPriority: 4096 })),
  lag_uplink: on(['SW1', 'SW2'], (n) => ({ ...n, ports: [0, 1].map((port) => ({ port, mode: 'access' as const, channelGroup: 1, lacp: 'active' as const })) })),
  dhcp_relay: (nodes) =>
    nodes.map((n) =>
      n.uid === 'SRV'
        ? { ...n, dhcpPools: [{ network: '192.168.1.0', prefix: 24, start: '192.168.1.100', end: '192.168.1.150', gateway: '192.168.1.1' }] }
        : n.uid === 'R1'
          ? ifaces(n, (i) => (i.port === 1 ? { ...i, helper: '10.0.1.2' } : i))
          : n,
    ),
  wifi_security: on(['AP1'], (n) => ({ ...n, wireless: { ...n.wireless, security: 'wpa2' as const } })),
  napt_office: on(['R1'], (n) => ({ ...ifaces(n, (i) => ({ ...i, nat: i.port === 0 ? ('outside' as const) : ('inside' as const) })), napt: true })),
  nat_firewall: on(['FW1'], (n) => ({ ...ifaces(n, (i) => ({ ...i, nat: i.port === 0 ? ('outside' as const) : ('inside' as const) })), napt: true, rules: [{ src: '192.168.1.0/24', dst: 'any', service: 'any' as const }] })),
};
