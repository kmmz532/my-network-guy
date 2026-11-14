// 論点の登録表。論点ごとに1行で、今のコードの名前（命令・show・失敗と警告の ID・用語集の ID・教材の ID）を指す。
// コードの移動はしない。試験 topics.test.ts が、登録された論点の各項目を言語ファイルと教材の定義に照らして確かめる。
// known は、その項目がまだ欠けていることの記録。試験は欠けていることを確かめ、埋めたら known から外すよう落とす。
import type { LangKey } from '../generated/lang-keys';

type Strip<K, P extends string> = K extends `${P}${infer I}` ? I : never;

// 失敗の ID（error.<ID>。直し方の .fix を除く）・警告の ID（warn.<ID>）・用語集の ID（glossary.<ID>）
export type ErrorId = Exclude<Strip<LangKey, 'error.'>, `${string}.fix`>;
export type WarnId = Strip<LangKey, 'warn.'>;
export type GlossaryId = Strip<LangKey, 'glossary.'>;

// 試験の項目の名前。命令（command）・show の命令（show）・失敗と警告（failures・warnings）・用語集（glossary）・教材（lesson）
export type TopicItem = 'command' | 'show' | 'failures' | 'warnings' | 'glossary' | 'lesson';

export interface Topic {
  id: string;
  // 解放のレベル（論点を出す会社のレベル）。帯の表にない論点は null
  unlock: number | null;
  // 設定の命令の一例（名前と引数の形。試験はこの行を設定の解釈に通す）
  command: string | null;
  // show の命令（ターミナルの確認の命令）
  show: string | null;
  failures: readonly ErrorId[];
  warnings: readonly WarnId[];
  glossary: GlossaryId | null;
  // 教材の ID（src/assets/data/lessons の id）
  lessons: readonly string[];
  known?: readonly TopicItem[];
}

export const TOPICS = [
  { id: 'vlan', unlock: 12, command: 'switchport 1 access vlan 10', show: 'show vlan brief', failures: ['vlan.not_allowed'], warnings: ['vlan.mismatch', 'vlan.native_mismatch'], glossary: 'dot1q', lessons: ['vlan_two_floors'] },
  { id: 'trunk', unlock: 16, command: 'switchport 7 trunk allowed 10,20', show: 'show vlan brief', failures: ['vlan.not_allowed'], warnings: ['vlan.native_mismatch'], glossary: 'native_vlan', lessons: ['vlan_two_floors'], known: ['command'] },
  { id: 'svi', unlock: 20, command: 'ip address vlan 10 192.168.10.1 255.255.255.0', show: 'show interfaces', failures: [], warnings: [], glossary: null, lessons: [], known: ['glossary', 'lesson'] },
  { id: 'static_route', unlock: 1, command: 'ip route 10.0.0.0 255.0.0.0 192.168.1.2', show: 'show ip route', failures: ['route.none', 'route.loop'], warnings: [], glossary: 'admin_distance', lessons: [], known: ['lesson'] },
  { id: 'rip', unlock: 56, command: 'router rip', show: 'show ip rip database', failures: ['rip.unreachable'], warnings: [], glossary: null, lessons: [], known: ['glossary', 'lesson'] },
  { id: 'ospf', unlock: 58, command: 'router ospf 1', show: 'show ip ospf neighbor', failures: ['ospf.area_detached', 'ospf.no_neighbor'], warnings: ['ospf.duplicate_router_id'], glossary: 'backbone_area', lessons: ['ospf_intro', 'ospf_three_sites'] },
  { id: 'bgp', unlock: 88, command: 'router bgp 64512', show: 'show ip bgp summary', failures: ['bgp.no_session', 'bgp.nexthop_unreachable'], warnings: [], glossary: 'as_number', lessons: ['bgp_two_isps'] },
  { id: 'vrrp', unlock: null, command: 'vrrp 0 1 ip 192.168.1.254', show: 'show vrrp', failures: ['vrrp.no_master'], warnings: ['vrrp.vip_mismatch', 'vrrp.gateway_real_ip'], glossary: 'vrrp', lessons: ['vrrp_pair'] },
  { id: 'lag', unlock: null, command: 'channel-group 0 1 mode active', show: 'show etherchannel summary', failures: [], warnings: ['lag.mismatch'], glossary: 'lacp', lessons: ['lag_uplink'] },
  { id: 'nat', unlock: 25, command: 'ip nat inside 0', show: 'show ip nat translations', failures: ['nat.no_forward', 'nat.private_source'], warnings: [], glossary: 'napt', lessons: ['napt_office'] },
  { id: 'dhcp', unlock: 14, command: 'ip dhcp pool 192.168.1.0 255.255.255.0 192.168.1.100 192.168.1.150', show: 'show ip dhcp binding', failures: ['dhcp.exhausted', 'dhcp.no_offer'], warnings: ['dhcp.multiple_servers'], glossary: 'dhcp_relay', lessons: ['dhcp_relay'] },
  { id: 'wireless', unlock: 40, command: 'wireless ssid home', show: null, failures: ['wireless.unassociated', 'wlan.psk_mismatch', 'wlan.auth_mismatch'], warnings: ['wlan.open', 'wlan.weak_cipher', 'wlan.channel_overlap', 'wlan.transition'], glossary: 'wpa2', lessons: ['wifi_security'], known: ['show'] },
  { id: 'stp', unlock: 70, command: 'spanning-tree priority 4096', show: 'show spanning-tree', failures: [], warnings: [], glossary: 'root_bridge', lessons: ['stp_triangle'] },
  { id: 'firewall', unlock: null, command: null, show: null, failures: ['firewall.denied'], warnings: [], glossary: null, lessons: [], known: ['command', 'show', 'glossary', 'lesson'] },
  { id: 'dns', unlock: 18, command: 'ip name-server 192.168.1.53', show: 'show hosts', failures: ['name.unresolved'], warnings: [], glossary: 'dns_auth_cache', lessons: [], known: ['lesson'] },
] as const satisfies readonly Topic[];
