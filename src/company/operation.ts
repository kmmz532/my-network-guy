// 世界への操作の型。画面・端末・自動化はどれもこの型の値を作り、dispatch（stores/gameOps.ts）へ渡す。
import type { Components } from '../network/components';
import type { DnsRecord, FirewallRule, IspLine, Route } from '../network/types';
import type { BgpOp, ChannelOp, DhcpOp, End, NatOp, OspfOp, PortChoice, PortModeChange, StpOp, VrrpOp } from '../sim/project';

// 機器の設定の変更。どの機器かは Operation の uid で決める
export type ConfigChange =
  | { kind: 'iface'; port: number; ip: string; prefix?: number }
  | { kind: 'svi'; vlan: number; ip: string; prefix?: number }
  | { kind: 'po'; channel: number; ip: string; prefix?: number }
  | { kind: 'portMode'; port: number; mode: PortModeChange }
  | { kind: 'gateway'; gateway: string | null }
  | { kind: 'routing'; change: { proto: 'rip' | 'ospf'; on: boolean; ip?: string; wildcard?: string; area?: number; process?: number | null } }
  | { kind: 'ifaceTune'; port: number; key: 'mtu' | 'adjustMss'; value: number | null }
  | { kind: 'portQos'; port: number; change: { qos: 'none' | 'priority' } | { trust: boolean } }
  | { kind: 'ospf'; change: OspfOp } | { kind: 'isp'; line: IspLine } | { kind: 'stp'; change: StpOp }
  | { kind: 'channel'; change: ChannelOp } | { kind: 'dhcp'; change: DhcpOp } | { kind: 'power'; on: boolean }
  | { kind: 'vrrp'; change: VrrpOp } | { kind: 'bgp'; change: BgpOp } | { kind: 'nat'; change: NatOp }
  | { kind: 'wireless'; key: 'ssid' | 'password' | 'band' | 'channel' | 'vlan' | 'security' | 'radius'; value: string | number | null }
  | { kind: 'firewallRules'; rules: FirewallRule[] } | { kind: 'loadBalancer'; servers: NonNullable<Components['loadBalancer']> } | { kind: 'vpn'; tunnels: NonNullable<Components['vpn']> } | { kind: 'plan'; port: number; network: string; prefix: number }
  | { kind: 'service'; protocol: 'http' | 'radius' | 'proxy'; on: boolean } | { kind: 'name'; name: string } | { kind: 'hostname'; hostname: string | null }
  | { kind: 'proxy'; proxy: { ip: string; port: number } | null } | { kind: 'pac'; direct: string[] | null }
  | { kind: 'nameServer'; ip: string | null } | { kind: 'dnsRole'; on: boolean; role?: 'auth' | 'cache' } | { kind: 'autoRegisterZone' }
  | { kind: 'dnsForwarder'; ip: string | null } | { kind: 'dnsRecord'; record: DnsRecord } | { kind: 'removeDnsRecord'; type: DnsRecord['type']; name: string }
  | { kind: 'host'; name: string; ip: string } | { kind: 'removeHost'; name: string }
  | { kind: 'addRoute'; route: Route } | { kind: 'removeRoute'; index: number };

export type Operation =
  | { kind: 'config'; uid: string; change: ConfigChange }
  | { kind: 'placeDevice'; device: string; x: number; y: number }
  | { kind: 'moveNode'; uid: string; x: number; y: number }
  | { kind: 'removeNode'; uid: string }
  | { kind: 'duplicateNode'; uid: string }
  | { kind: 'connect'; a: string; b: string; cable: string; ports?: PortChoice }
  | { kind: 'removeLink'; uid: string }
  | { kind: 'replug'; link: string; end: End; port: number }
  | { kind: 'replugTo'; link: string; end: End; node: string; port: number | null }
  | { kind: 'swapPlugs'; node: string; from: number; to: number }
  | { kind: 'placeFurniture'; id: string; x: number; y: number }
  | { kind: 'moveFurniture'; uid: string; x: number; y: number }
  | { kind: 'rotateFurniture'; uid: string }
  | { kind: 'removeFurniture'; uid: string }
  | { kind: 'buy'; id: string } | { kind: 'sell'; id: string };
