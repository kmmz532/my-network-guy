// ターミナルの設定のコマンド（段階3）。入力の行を、画面の操作（ConfigAction）に読み替える純粋な関数。
// 書式（モードは持たない。ポート番号は行の中で指定する）:
//   ip address <ポート> <IP> <マスク>   例: ip address 0 192.168.1.10 255.255.255.0
//   ip default-gateway <IP>
//   ip route <宛先> <マスク> <次ホップ>
//   no ip default-gateway
//   no ip route <宛先> <マスク>
//   hostname <名前>   /   no hostname   （ホスト名の規則は hostname.ts。英字で始まり、英数字とハイフン、63文字まで）
//   ip name-server <IP>   /   no ip name-server   （名前を引くネームサーバー。N68）
//   ip host <名前> <IP>   /   no ip host <名前>   （対応表。ping・traceroute の宛先の名前を引く）
import type { DhcpPool } from './dhcp';
import type { Tr } from './terminal';
import type { Route } from './types';
import { isValidHostname } from './hostname';

export type ConfigAction =
  | { kind: 'iface'; port: number; ip: string; prefix: number }
  // SVI（VLAN のインターフェース・N138）: ip address vlan <番号> <IP> <マスク> / no ip address vlan <番号>（ip が空なら外す）
  | { kind: 'svi'; vlan: number; ip: string; prefix: number }
  // 口のモード（N137・N138）: switchport <ポート> access vlan <番号> / no switchport <ポート>（routed）
  // trunk: switchport <ポート> trunk [allowed <番号,番号…|all>] [native <番号>]
  | { kind: 'portMode'; port: number; mode: { kind: 'access'; vlan: number } | { kind: 'routed' } | { kind: 'trunk'; allowed?: number[] | null; native?: number } }
  | { kind: 'gateway'; gateway: string | null }
  | { kind: 'addRoute'; route: Route }
  | { kind: 'removeRoute'; dest: string; prefix: number }
  | { kind: 'hostname'; hostname: string | null }
  | { kind: 'host'; name: string; ip: string }
  | { kind: 'noHost'; name: string }
  | { kind: 'nameServer'; ip: string | null }
  // RIP・OSPF の有効（router rip / router ospf）。on が false は no router ...（N141b・N143）
  | { kind: 'routing'; proto: 'rip' | 'ospf'; on: boolean }
  // network 文: ip のサブネットのインターフェースを、RIP または OSPF（エリア 0）に参加させる（N143）
  | { kind: 'network'; proto: 'rip' | 'ospf'; ip: string; area: number | null; on: boolean }
  // VRRP: vrrp <口> <VRID> ip <IP>・priority <値>・preempt（no で解除）・track <追跡の口> decrement <値>・no vrrp <口> <VRID>
  | { kind: 'vrrp'; op: 'ip'; port: number; vrid: number; ip: string }
  | { kind: 'vrrp'; op: 'priority'; port: number; vrid: number; value: number }
  | { kind: 'vrrp'; op: 'preempt'; port: number; vrid: number; on: boolean }
  | { kind: 'vrrp'; op: 'track'; port: number; vrid: number; trackPort: number; decrement: number }
  | { kind: 'vrrp'; op: 'remove'; port: number; vrid: number }
  // スパニングツリー: spanning-tree priority <0〜61440 の4096刻み>・spanning-tree cost <口> <値>
  | { kind: 'stp'; op: 'priority'; value: number }
  | { kind: 'stp'; op: 'cost'; port: number; value: number }
  // リンクアグリゲーション: channel-group <口> <番号> mode active|passive|on・no channel-group <口>（番号 null は解除）
  | { kind: 'channel'; port: number; group: number | null; lacp?: 'active' | 'passive' | 'on' }
  // DHCP: ip address <口> dhcp（自動）・ip helper-address <口> <IP>（no で解除）・ip dhcp pool <ネットワーク> <マスク> <先頭> <末尾> [gateway <IP>] [dns <IP>]・no ip dhcp pool <ネットワーク>
  | { kind: 'dhcp'; op: 'client'; port: number }
  | { kind: 'dhcp'; op: 'helper'; port: number; ip: string | null }
  | { kind: 'dhcp'; op: 'pool'; pool: DhcpPool }
  | { kind: 'dhcp'; op: 'noPool'; network: string }
  // OSPF の機器・インターフェースの設定: router-id <IP>・no router-id・default-information originate・no default-information originate・
  // ip ospf cost|priority|hello-interval|dead-interval <口> <値>
  | { kind: 'ospf'; op: 'routerId'; ip: string | null }
  | { kind: 'ospf'; op: 'defaultOriginate'; on: boolean }
  | { kind: 'ospf'; op: 'iface'; port: number; key: 'cost' | 'priority' | 'hello' | 'dead'; value: number }
  // NAT（N145）: ip nat inside|outside <ポート> / no ip nat <ポート> / ip nat napt / no ip nat napt / ip nat static <外のポート> <社内のIP> <社内のポート> / no ip nat static <外のポート>
  | { kind: 'nat'; op: 'iface'; port: number; nat: 'inside' | 'outside' | null }
  | { kind: 'nat'; op: 'napt'; on: boolean }
  | { kind: 'nat'; op: 'static'; port: number; insideIp: string; insidePort: number }
  | { kind: 'nat'; op: 'noStatic'; port: number }
  // 無線（N151）: wireless ssid <名前> / wireless password <8字以上> / wireless channel <1-13> / wireless vlan <番号>
  | { kind: 'wireless'; key: 'ssid' | 'password' | 'channel' | 'vlan'; value: string | number }
  // BGP（N147）: 自分の AS・隣接（neighbor）・広告する宛先（network … mask）
  | { kind: 'bgp'; op: 'asn'; asn: number }
  | { kind: 'bgp'; op: 'off' }
  | { kind: 'bgp'; op: 'neighbor'; ip: string; remoteAs: number }
  // neighbor <IP> next-hop-self・local-preference|med|prepend <値>（ゲーム独自の書き方。ルートマップは扱わない）
  | { kind: 'bgp'; op: 'attr'; ip: string; key: 'nextHopSelf'; value: boolean }
  | { kind: 'bgp'; op: 'attr'; ip: string; key: 'localPref' | 'med' | 'prepend'; value: number }
  | { kind: 'bgp'; op: 'network'; dest: string; prefix: number };

export type ConfigParse = { kind: 'action'; action: ConfigAction } | { kind: 'error'; text: string } | { kind: 'none' };

const IP_RE = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

export const isIp = (s: string): boolean => {
  const m = IP_RE.exec(s);
  return m !== null && m.slice(1).every((x) => Number(x) <= 255);
};

// 点区切りのマスク（255.255.255.0）をプレフィックス長（24）に直す。連続した1でなければ null
export const maskToPrefix = (mask: string): number | null => {
  if (!isIp(mask)) return null;
  const bits = mask
    .split('.')
    .map((x) => Number(x).toString(2).padStart(8, '0'))
    .join('');
  if (!/^1*0*$/.test(bits)) return null;
  return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
};

// 名前（hostname・対応表）の形（hostname.ts の規則）
export const isHostName = (s: string): boolean => isValidHostname(s);

const port = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);
// VLAN の番号（1〜4094）
const vlanNumber = (s: string): number | null => (/^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 4094 ? Number(s) : null);

export const parseConfig = (line: string, tr: Tr): ConfigParse => {
  const words = line.trim().split(/\s+/).filter((w) => w !== '');
  const [first, ...rest] = words;
  if (first !== 'ip' && first !== 'no' && first !== 'hostname' && first !== 'vrrp' && first !== 'channel-group' && first !== 'spanning-tree' && first !== 'router' && first !== 'router-id' && first !== 'default-information' && first !== 'network' && first !== 'neighbor' && first !== 'wireless' && first !== 'switchport') return { kind: 'none' };
  const error = (key: string) => ({ kind: 'error' as const, text: tr(key) });

  // router rip / router ospf <番号>（no で止める）
  if (first === 'router' && (rest[0] === 'rip' || rest[0] === 'ospf')) {
    return { kind: 'action', action: { kind: 'routing', proto: rest[0], on: true } };
  }
  if (first === 'no' && rest[0] === 'router' && (rest[1] === 'rip' || rest[1] === 'ospf')) {
    return { kind: 'action', action: { kind: 'routing', proto: rest[1], on: false } };
  }
  // VRRP
  const vrrpArgs = (w: string[]) => {
    const p = port(w[0] ?? '');
    const vrid = /^[0-9]+$/.test(w[1] ?? '') ? Number(w[1]) : null;
    return p === null || vrid === null || vrid < 1 || vrid > 255 ? null : { p, vrid };
  };
  if (first === 'vrrp') {
    const a = vrrpArgs(rest);
    if (!a) return error('ui.terminal.usageVrrp');
    const [, , key, v1, kw, v2] = rest;
    if (key === 'ip' && rest.length === 4 && isIp(v1)) return { kind: 'action', action: { kind: 'vrrp', op: 'ip', port: a.p, vrid: a.vrid, ip: v1 } };
    if (key === 'priority' && rest.length === 4 && /^[0-9]+$/.test(v1)) return { kind: 'action', action: { kind: 'vrrp', op: 'priority', port: a.p, vrid: a.vrid, value: Number(v1) } };
    if (key === 'preempt' && rest.length === 3) return { kind: 'action', action: { kind: 'vrrp', op: 'preempt', port: a.p, vrid: a.vrid, on: true } };
    if (key === 'track' && rest.length === 6 && port(v1) !== null && kw === 'decrement' && /^[0-9]+$/.test(v2)) return { kind: 'action', action: { kind: 'vrrp', op: 'track', port: a.p, vrid: a.vrid, trackPort: Number(v1), decrement: Number(v2) } };
    return error('ui.terminal.usageVrrp');
  }
  // リンクアグリゲーション
  if (first === 'channel-group') {
    const lacp = rest[3] === 'active' || rest[3] === 'passive' || rest[3] === 'on' ? rest[3] : null;
    if (rest.length !== 4 || port(rest[0]) === null || !/^[0-9]+$/.test(rest[1]) || rest[2] !== 'mode' || lacp === null) return error('ui.terminal.usageChannel');
    return { kind: 'action', action: { kind: 'channel', port: Number(rest[0]), group: Number(rest[1]), lacp } };
  }
  if (first === 'no' && rest[0] === 'channel-group') {
    if (rest.length !== 2 || port(rest[1]) === null) return error('ui.terminal.usageChannel');
    return { kind: 'action', action: { kind: 'channel', port: Number(rest[1]), group: null } };
  }
  if (first === 'no' && rest[0] === 'vrrp') {
    const a = vrrpArgs(rest.slice(1));
    if (!a) return error('ui.terminal.usageVrrp');
    if (rest.length === 3) return { kind: 'action', action: { kind: 'vrrp', op: 'remove', port: a.p, vrid: a.vrid } };
    if (rest.length === 4 && rest[3] === 'preempt') return { kind: 'action', action: { kind: 'vrrp', op: 'preempt', port: a.p, vrid: a.vrid, on: false } };
    return error('ui.terminal.usageVrrp');
  }
  // スパニングツリー
  if (first === 'spanning-tree') {
    if (rest[0] === 'priority' && rest.length === 2 && /^[0-9]+$/.test(rest[1])) {
      const v = Number(rest[1]);
      if (v > 61440 || v % 4096 !== 0) return error('ui.terminal.errStpPriority');
      return { kind: 'action', action: { kind: 'stp', op: 'priority', value: v } };
    }
    if (rest[0] === 'cost' && rest.length === 3 && port(rest[1]) !== null && /^[0-9]+$/.test(rest[2]) && Number(rest[2]) >= 1) {
      return { kind: 'action', action: { kind: 'stp', op: 'cost', port: Number(rest[1]), value: Number(rest[2]) } };
    }
    return error('ui.terminal.usageStp');
  }
  // OSPF の機器・インターフェースの設定
  if (first === 'router-id') {
    if (rest.length !== 1 || !isIp(rest[0])) return error('ui.terminal.usageOspf');
    return { kind: 'action', action: { kind: 'ospf', op: 'routerId', ip: rest[0] } };
  }
  if (first === 'no' && rest[0] === 'router-id') return { kind: 'action', action: { kind: 'ospf', op: 'routerId', ip: null } };
  if (first === 'default-information' || (first === 'no' && rest[0] === 'default-information')) {
    const tail = first === 'no' ? rest.slice(1) : rest;
    if (tail.length !== 1 || tail[0] !== 'originate') return error('ui.terminal.usageOspf');
    return { kind: 'action', action: { kind: 'ospf', op: 'defaultOriginate', on: first !== 'no' } };
  }
  if (first === 'ip' && rest[0] === 'ospf') {
    const keys = { cost: 'cost', priority: 'priority', 'hello-interval': 'hello', 'dead-interval': 'dead' } as const;
    const key = keys[rest[1] as keyof typeof keys];
    if (key === undefined || rest.length !== 4 || !/^[0-9]+$/.test(rest[2]) || !/^[0-9]+$/.test(rest[3])) return error('ui.terminal.usageOspf');
    return { kind: 'action', action: { kind: 'ospf', op: 'iface', port: Number(rest[2]), key, value: Number(rest[3]) } };
  }
  // DHCP
  if (first === 'ip' && rest[0] === 'helper-address') {
    if (rest.length !== 3 || port(rest[1]) === null || !isIp(rest[2])) return error('ui.terminal.usageDhcp');
    return { kind: 'action', action: { kind: 'dhcp', op: 'helper', port: Number(rest[1]), ip: rest[2] } };
  }
  if (first === 'no' && rest[0] === 'ip' && rest[1] === 'helper-address') {
    if (rest.length !== 3 || port(rest[2]) === null) return error('ui.terminal.usageDhcp');
    return { kind: 'action', action: { kind: 'dhcp', op: 'helper', port: Number(rest[2]), ip: null } };
  }
  if (first === 'ip' && rest[0] === 'dhcp' && rest[1] === 'pool') {
    const [, , network, mask, start, end, ...opts] = rest;
    const prefix = maskToPrefix(mask ?? '');
    if (!isIp(network ?? '') || prefix === null || !isIp(start ?? '') || !isIp(end ?? '') || opts.length % 2 !== 0) return error('ui.terminal.usageDhcp');
    const pool: DhcpPool = { network, prefix, start, end };
    for (let i = 0; i < opts.length; i += 2) {
      if ((opts[i] !== 'gateway' && opts[i] !== 'dns') || !isIp(opts[i + 1])) return error('ui.terminal.usageDhcp');
      pool[opts[i] as 'gateway' | 'dns'] = opts[i + 1];
    }
    return { kind: 'action', action: { kind: 'dhcp', op: 'pool', pool } };
  }
  if (first === 'no' && rest[0] === 'ip' && rest[1] === 'dhcp' && rest[2] === 'pool') {
    if (rest.length !== 4 || !isIp(rest[3])) return error('ui.terminal.usageDhcp');
    return { kind: 'action', action: { kind: 'dhcp', op: 'noPool', network: rest[3] } };
  }
  // 無線（N151）
  if (first === 'wireless') {
    const [key, value] = rest;
    if (key === 'ssid' && value !== undefined && value.length <= 32) return { kind: 'action', action: { kind: 'wireless', key: 'ssid', value } };
    if (key === 'password' && value !== undefined && value.length >= 8) return { kind: 'action', action: { kind: 'wireless', key: 'password', value } };
    if (key === 'channel' && /^[0-9]+$/.test(value ?? '') && Number(value) >= 1 && Number(value) <= 13) return { kind: 'action', action: { kind: 'wireless', key: 'channel', value: Number(value) } };
    if (key === 'vlan' && /^[0-9]+$/.test(value ?? '') && Number(value) >= 1) return { kind: 'action', action: { kind: 'wireless', key: 'vlan', value: Number(value) } };
    return error('ui.terminal.usageWireless');
  }
  // ip nat（NAT・N145）
  if (first === 'ip' && rest[0] === 'nat') {
    const [, kind, a, b, c] = rest;
    if ((kind === 'inside' || kind === 'outside') && port(a ?? '') !== null && rest.length === 3) return { kind: 'action', action: { kind: 'nat', op: 'iface', port: Number(a), nat: kind } };
    if (kind === 'napt' && rest.length === 2) return { kind: 'action', action: { kind: 'nat', op: 'napt', on: true } };
    if (kind === 'static' && rest.length === 5 && port(a ?? '') !== null && isIp(b ?? '') && port(c ?? '') !== null) return { kind: 'action', action: { kind: 'nat', op: 'static', port: Number(a), insideIp: b, insidePort: Number(c) } };
    return error('ui.terminal.usageNat');
  }
  if (first === 'no' && rest[0] === 'ip' && rest[1] === 'nat') {
    if (rest[2] === 'napt' && rest.length === 3) return { kind: 'action', action: { kind: 'nat', op: 'napt', on: false } };
    if (rest[2] === 'static' && rest.length === 4 && port(rest[3]) !== null) return { kind: 'action', action: { kind: 'nat', op: 'noStatic', port: Number(rest[3]) } };
    if (rest.length === 3 && port(rest[2]) !== null) return { kind: 'action', action: { kind: 'nat', op: 'iface', port: Number(rest[2]), nat: null } };
    return error('ui.terminal.usageNat');
  }
  // router bgp <AS>・no router bgp・neighbor <IP> remote-as <AS>・network <IP> mask <マスク>（BGP）
  if (first === 'router' && rest[0] === 'bgp') {
    if (!/^[0-9]+$/.test(rest[1] ?? '')) return error('ui.terminal.usageBgp');
    return { kind: 'action', action: { kind: 'bgp', op: 'asn', asn: Number(rest[1]) } };
  }
  if (first === 'no' && rest[0] === 'router' && rest[1] === 'bgp') return { kind: 'action', action: { kind: 'bgp', op: 'off' } };
  if (first === 'neighbor' && isIp(rest[0] ?? '') && rest[1] === 'next-hop-self' && rest.length === 2) return { kind: 'action', action: { kind: 'bgp', op: 'attr', ip: rest[0], key: 'nextHopSelf', value: true } };
  if (first === 'no' && rest[0] === 'neighbor' && isIp(rest[1] ?? '') && rest[2] === 'next-hop-self' && rest.length === 3) return { kind: 'action', action: { kind: 'bgp', op: 'attr', ip: rest[1], key: 'nextHopSelf', value: false } };
  if (first === 'neighbor' && isIp(rest[0] ?? '') && rest.length === 3 && /^[0-9]+$/.test(rest[2])) {
    const keys = { 'local-preference': 'localPref', med: 'med', prepend: 'prepend' } as const;
    const key = keys[rest[1] as keyof typeof keys];
    if (key !== undefined) return { kind: 'action', action: { kind: 'bgp', op: 'attr', ip: rest[0], key, value: Number(rest[2]) } };
  }
  if (first === 'neighbor') {
    if (rest.length !== 3 || rest[1] !== 'remote-as' || !isIp(rest[0]) || !/^[0-9]+$/.test(rest[2])) return error('ui.terminal.usageBgp');
    return { kind: 'action', action: { kind: 'bgp', op: 'neighbor', ip: rest[0], remoteAs: Number(rest[2]) } };
  }
  if (first === 'network' && rest.length === 3 && rest[1] === 'mask' && isIp(rest[0])) {
    const prefix = maskToPrefix(rest[2]);
    if (prefix === null) return error('ui.terminal.errIp');
    return { kind: 'action', action: { kind: 'bgp', op: 'network', dest: rest[0], prefix } };
  }
  // network <IP>（RIP）・network <IP> <ワイルドカード> area <エリア>（OSPF。MVP はエリア 0 だけ）
  if (first === 'network') {
    if (rest.length === 1 && isIp(rest[0])) return { kind: 'action', action: { kind: 'network', proto: 'rip', ip: rest[0], area: null, on: true } };
    if (rest.length === 4 && isIp(rest[0]) && isIp(rest[1]) && rest[2] === 'area' && (/^[0-9]+$/.test(rest[3]) || isIp(rest[3]))) {
      // エリアは整数と、試験の書き方の 0.0.0.0 の両方を受け付ける
      const area = isIp(rest[3]) ? rest[3].split('.').reduce((a, x) => a * 256 + Number(x), 0) : Number(rest[3]);
      return { kind: 'action', action: { kind: 'network', proto: 'ospf', ip: rest[0], area, on: true } };
    }
    return error('ui.terminal.usageNetwork');
  }
  if (first === 'no' && rest[0] === 'network' && rest.length === 2 && isIp(rest[1])) {
    return { kind: 'action', action: { kind: 'network', proto: 'rip', ip: rest[1], area: null, on: false } };
  }

  if (first === 'ip' && rest[0] === 'address' && rest[1] === 'vlan') {
    if (rest.length !== 5) return error('ui.terminal.usageSvi');
    const v = vlanNumber(rest[2]);
    if (v === null) return error('ui.terminal.errVlan');
    if (!isIp(rest[3])) return error('ui.terminal.errIp');
    const prefix = maskToPrefix(rest[4]);
    if (prefix === null) return error('ui.terminal.errMask');
    return { kind: 'action', action: { kind: 'svi', vlan: v, ip: rest[3], prefix } };
  }
  if (first === 'no' && rest[0] === 'ip' && rest[1] === 'address' && rest[2] === 'vlan') {
    if (rest.length !== 4) return error('ui.terminal.usageSvi');
    const v = vlanNumber(rest[3]);
    if (v === null) return error('ui.terminal.errVlan');
    return { kind: 'action', action: { kind: 'svi', vlan: v, ip: '', prefix: 24 } };
  }
  if (first === 'switchport' && rest[1] === 'trunk') {
    const p = port(rest[0]);
    if (p === null) return error('ui.terminal.errPort');
    const mode: { kind: 'trunk'; allowed?: number[] | null; native?: number } = { kind: 'trunk' };
    let i = 2;
    while (i < rest.length) {
      if (rest[i] === 'allowed' && rest[i + 1] !== undefined) {
        if (rest[i + 1] === 'all') mode.allowed = null;
        else {
          const list = rest[i + 1].split(',').map(vlanNumber);
          if (list.some((v) => v === null)) return error('ui.terminal.errVlan');
          mode.allowed = list as number[];
        }
        i += 2;
      } else if (rest[i] === 'native' && rest[i + 1] !== undefined) {
        const v = vlanNumber(rest[i + 1]);
        if (v === null) return error('ui.terminal.errVlan');
        mode.native = v;
        i += 2;
      } else return error('ui.terminal.usageSwitchport');
    }
    return { kind: 'action', action: { kind: 'portMode', port: p, mode } };
  }
  if (first === 'switchport') {
    if (rest.length !== 4 || rest[1] !== 'access' || rest[2] !== 'vlan') return error('ui.terminal.usageSwitchport');
    const p = port(rest[0]);
    if (p === null) return error('ui.terminal.errPort');
    const v = vlanNumber(rest[3]);
    if (v === null) return error('ui.terminal.errVlan');
    return { kind: 'action', action: { kind: 'portMode', port: p, mode: { kind: 'access', vlan: v } } };
  }
  if (first === 'no' && rest[0] === 'switchport') {
    if (rest.length !== 2) return error('ui.terminal.usageSwitchport');
    const p = port(rest[1]);
    if (p === null) return error('ui.terminal.errPort');
    return { kind: 'action', action: { kind: 'portMode', port: p, mode: { kind: 'routed' } } };
  }

  if (first === 'ip' && rest[0] === 'address' && rest.length === 3 && rest[2] === 'dhcp') {
    const p = port(rest[1]);
    if (p === null) return error('ui.terminal.errPort');
    return { kind: 'action', action: { kind: 'dhcp', op: 'client', port: p } };
  }
  if (first === 'ip' && rest[0] === 'address') {
    if (rest.length !== 4) return error('ui.terminal.usageIpAddress');
    const p = port(rest[1]);
    if (p === null) return error('ui.terminal.errPort');
    if (!isIp(rest[2])) return error('ui.terminal.errIp');
    const prefix = maskToPrefix(rest[3]);
    if (prefix === null) return error('ui.terminal.errMask');
    return { kind: 'action', action: { kind: 'iface', port: p, ip: rest[2], prefix } };
  }

  if (first === 'ip' && rest[0] === 'host') {
    if (rest.length !== 3) return error('ui.terminal.usageHost');
    if (!isHostName(rest[1])) return error('ui.terminal.errHostname');
    if (!isIp(rest[2])) return error('ui.terminal.errIp');
    return { kind: 'action', action: { kind: 'host', name: rest[1], ip: rest[2] } };
  }

  if (first === 'no' && rest[0] === 'ip' && rest[1] === 'host') {
    if (rest.length !== 3) return error('ui.terminal.usageNoHost');
    if (!isHostName(rest[2])) return error('ui.terminal.errHostname');
    return { kind: 'action', action: { kind: 'noHost', name: rest[2] } };
  }

  if (first === 'ip' && rest[0] === 'default-gateway') {
    if (rest.length !== 2) return error('ui.terminal.usageGateway');
    if (!isIp(rest[1])) return error('ui.terminal.errIp');
    return { kind: 'action', action: { kind: 'gateway', gateway: rest[1] } };
  }

  if (first === 'ip' && rest[0] === 'route') {
    if (rest.length !== 4) return error('ui.terminal.usageRoute');
    if (!isIp(rest[1]) || !isIp(rest[3])) return error('ui.terminal.errIp');
    const prefix = maskToPrefix(rest[2]);
    if (prefix === null) return error('ui.terminal.errMask');
    return { kind: 'action', action: { kind: 'addRoute', route: { dest: rest[1], prefix, nextHop: rest[3] } } };
  }

  if (first === 'hostname') {
    if (rest.length !== 1) return error('ui.terminal.usageHostname');
    if (!isValidHostname(rest[0])) return error('ui.terminal.errHostname');
    return { kind: 'action', action: { kind: 'hostname', hostname: rest[0] } };
  }

  if (first === 'no' && rest[0] === 'hostname' && rest.length === 1) {
    return { kind: 'action', action: { kind: 'hostname', hostname: null } };
  }

  if (first === 'ip' && rest[0] === 'name-server') {
    if (rest.length !== 2) return error('ui.terminal.usageNameServer');
    if (!isIp(rest[1])) return error('ui.terminal.errIp');
    return { kind: 'action', action: { kind: 'nameServer', ip: rest[1] } };
  }

  if (first === 'no' && rest[0] === 'ip' && rest[1] === 'name-server') {
    if (rest.length !== 2) return error('ui.terminal.usageNameServer');
    return { kind: 'action', action: { kind: 'nameServer', ip: null } };
  }

  if (first === 'no' && rest[0] === 'ip' && rest[1] === 'default-gateway' && rest.length === 2) {
    return { kind: 'action', action: { kind: 'gateway', gateway: null } };
  }

  if (first === 'no' && rest[0] === 'ip' && rest[1] === 'route') {
    if (rest.length !== 4) return error('ui.terminal.usageNoRoute');
    if (!isIp(rest[2])) return error('ui.terminal.errIp');
    const prefix = maskToPrefix(rest[3]);
    if (prefix === null) return error('ui.terminal.errMask');
    return { kind: 'action', action: { kind: 'removeRoute', dest: rest[2], prefix } };
  }

  return error('ui.terminal.unknown');
};
