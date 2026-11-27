// 失敗の理由ごとに、案件の欄で説明する用語（用語集の ID。言語ファイルの glossary.<ID>）。対応のない理由は説明を出さない
import type { Capability, Goal } from '../data/schema';
import type { FailureReason } from './types';
import { TOPICS, type Topic } from './topics';

export const GLOSSARY_OF_FAILURE: Partial<Record<FailureReason, string>> = {
  'vrrp.no_master': 'vrrp',
  'ospf.area_detached': 'backbone_area',
  'bgp.no_session': 'as_number',
  'bgp.nexthop_unreachable': 'ebgp_ibgp',
  'nat.private_source': 'napt',
  'nat.no_forward': 'napt',
  'vlan.not_allowed': 'dot1q',
  'vlan.same': 'dot1q',
  'wlan.psk_mismatch': 'wpa2',
  'wlan.auth_mismatch': 'wpa3',
  'wlan.no_radius': 'radius',
  'lb.few_healthy': 'load_balancer',
  'vpn.peer_unreachable': 'ipsec_vpn',
  'vpn.psk_mismatch': 'ipsec_vpn',
  'vpn.proposal_mismatch': 'ipsec_vpn',
  'vpn.selector_mismatch': 'ipsec_vpn',
  'vpn.nat_before_tunnel': 'ipsec_vpn',
  'mtu.exceeded': 'mtu',
  'qos.dropped': 'qos',
};

// 教材の案内の手順（文言のキー）ごとに、その手順で初めて出す用語。対応のない手順は説明を出さない
export const GLOSSARY_OF_STEP: Record<string, string> = {
  // 最初の案件の流れで初めて出る基本の用語（N165）
  'guide.c001_direct_link.2': 'lan_cable',
  'guide.c001_direct_link.6': 'ip_address',
  'guide.c001_direct_link.10': 'ping',
  'guide.c002_small_office.2': 'switch',
  'guide.c003_departments.1': 'router',
  'guide.c003_departments.8': 'gateway',
  'guide.c004_web_server.1': 'server',
  'guide.c004_web_server.2': 'service',
  'lesson.bgp_two_isps.step.2': 'as_number',
  'lesson.bgp_two_isps.step.3': 'ebgp_ibgp',
  'lesson.bgp_two_isps.step.5': 'as_path',
  'lesson.dhcp_relay.step.3': 'dhcp_relay',
  'lesson.dns_intranet_names.step.2': 'dns_auth_cache',
  'lesson.lag_uplink.step.2': 'lacp',
  'lesson.mtu_vpn.step.2': 'mtu',
  'lesson.napt_office.step.4': 'napt',
  'lesson.qos_voice.step.2': 'qos',
  'lesson.nat_firewall.step.5': 'firewall',
  'lesson.ospf_areas.step.1': 'abr',
  'lesson.ospf_dr.step.7': 'dr_bdr',
  'lesson.ospf_intro.step.4': 'wildcard_mask',
  'lesson.ospf_three_sites.step.3': 'backbone_area',
  'lesson.rip_three_sites.step.3': 'rip',
  'lesson.stp_triangle.step.2': 'root_bridge',
  'lesson.vlan_two_floors.step.5': 'dot1q',
  'lesson.vrrp_pair.step.2': 'vrrp',
  'lesson.wifi_security.step.2': 'wep',
  'lesson.wifi_security.step.3': 'wpa3',
  'lesson.wildcard_mask.step.3': 'wildcard_mask',
};

// 機器の設定の欄に出る設定の部品（機器の能力）ごとの用語。並びが、欄を開いたときに先に出す順になる
export const GLOSSARY_OF_SETTING: readonly (readonly [Capability, string])[] = [
  ['svi', 'svi'],
  ['vrrp', 'vrrp'],
  ['bgp', 'as_number'],
  ['lag', 'lacp'],
  ['switchport', 'dot1q'],
  ['nat', 'napt'],
  ['wireless', 'wpa2'],
];

// 達成条件の種類ごとの用語（失敗の理由に対応がないときに使う）
export const GLOSSARY_OF_GOAL: Partial<Record<Goal['type'], string>> = {
  bgp_established: 'as_number',
  bgp_exit: 'local_pref',
  bgp_usable: 'ebgp_ibgp',
  lag_bundled: 'lacp',
  stp_root: 'root_bridge',
  ospf_dr: 'dr_bdr',
  wireless_secure: 'wpa2',
  wireless_clean: 'channel_overlap',
  outside_reachable: 'napt',
  firewall: 'firewall',
  blocked: 'firewall',
  blocked_all: 'firewall',
  reach_by_name: 'dns_auth_cache',
  http_by_name: 'dns_auth_cache',
  resolve_name: 'dns_auth_cache',
  min_speed: 'link_speed',
  qos_voice: 'qos',
  load_balanced: 'load_balancer',
  public_http: 'napt',
  outside_sees: 'proxy',
  mail: 'mail_mx',
  vpn_up: 'ipsec_vpn',
};

export const termOfStep = (key: string): string | null => GLOSSARY_OF_STEP[key] ?? null;

export const termOfGoal = (type: Goal['type']): string | null => GLOSSARY_OF_GOAL[type] ?? null;

// 教材を開いている間に設定の欄で出してよい用語: その教材を lessons に持つ論点の glossary
export const termsOfLesson = (lessonId: string): readonly string[] =>
  (TOPICS as readonly Topic[]).filter((topic) => topic.lessons.includes(lessonId)).flatMap((topic) => (topic.glossary ? [topic.glossary] : []));

// 設定の欄を開いたときに出す用語: 機器が持つ設定の部品のうち、まだ出していない最初のもの。allowed を渡したときは、その一覧にある用語だけ。なければ null
export const termOfSettings = (
  has: (capability: Capability) => boolean,
  shown: readonly string[],
  allowed?: readonly string[],
): string | null =>
  GLOSSARY_OF_SETTING.find(([capability, term]) => has(capability) && !shown.includes(term) && (allowed === undefined || allowed.includes(term)))?.[1] ?? null;
