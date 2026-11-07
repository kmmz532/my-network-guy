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
import type { Tr } from './terminal';
import type { Route } from './types';
import { isValidHostname } from './hostname';

export type ConfigAction =
  | { kind: 'iface'; port: number; ip: string; prefix: number }
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
  // NAT（N145）: ip nat inside|outside <ポート> / no ip nat <ポート> / ip nat napt / no ip nat napt / ip nat static <外のポート> <社内のIP> <社内のポート> / no ip nat static <外のポート>
  | { kind: 'nat'; op: 'iface'; port: number; nat: 'inside' | 'outside' | null }
  | { kind: 'nat'; op: 'napt'; on: boolean }
  | { kind: 'nat'; op: 'static'; port: number; insideIp: string; insidePort: number }
  | { kind: 'nat'; op: 'noStatic'; port: number }
  // BGP（N147）: 自分の AS・隣接（neighbor）・広告する宛先（network … mask）
  | { kind: 'bgp'; op: 'asn'; asn: number }
  | { kind: 'bgp'; op: 'off' }
  | { kind: 'bgp'; op: 'neighbor'; ip: string; remoteAs: number }
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

export const parseConfig = (line: string, tr: Tr): ConfigParse => {
  const words = line.trim().split(/\s+/).filter((w) => w !== '');
  const [first, ...rest] = words;
  if (first !== 'ip' && first !== 'no' && first !== 'hostname' && first !== 'router' && first !== 'network' && first !== 'neighbor') return { kind: 'none' };
  const error = (key: string) => ({ kind: 'error' as const, text: tr(key) });

  // router rip / router ospf <番号>（no で止める）
  if (first === 'router' && (rest[0] === 'rip' || rest[0] === 'ospf')) {
    return { kind: 'action', action: { kind: 'routing', proto: rest[0], on: true } };
  }
  if (first === 'no' && rest[0] === 'router' && (rest[1] === 'rip' || rest[1] === 'ospf')) {
    return { kind: 'action', action: { kind: 'routing', proto: rest[1], on: false } };
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
    if (rest.length === 4 && isIp(rest[0]) && isIp(rest[1]) && rest[2] === 'area' && /^[0-9]+$/.test(rest[3])) {
      const area = Number(rest[3]);
      if (area !== 0) return error('ui.terminal.errArea');
      return { kind: 'action', action: { kind: 'network', proto: 'ospf', ip: rest[0], area, on: true } };
    }
    return error('ui.terminal.usageNetwork');
  }
  if (first === 'no' && rest[0] === 'network' && rest.length === 2 && isIp(rest[1])) {
    return { kind: 'action', action: { kind: 'network', proto: 'rip', ip: rest[1], area: null, on: false } };
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
