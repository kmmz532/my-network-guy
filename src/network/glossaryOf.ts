// 失敗の理由ごとに、案件の欄で説明する用語（用語集の ID。言語ファイルの glossary.<ID>）。対応のない理由は説明を出さない
import type { FailureReason } from './types';

export const GLOSSARY_OF_FAILURE: Partial<Record<FailureReason, string>> = {
  'vrrp.no_master': 'vrrp',
  'ospf.area_detached': 'backbone_area',
  'bgp.no_session': 'as_number',
  'bgp.nexthop_unreachable': 'ebgp_ibgp',
  'nat.private_source': 'napt',
  'nat.no_forward': 'napt',
  'vlan.not_allowed': 'dot1q',
  'wlan.psk_mismatch': 'wpa2',
  'wlan.auth_mismatch': 'wpa3',
};
