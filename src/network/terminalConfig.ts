// ターミナルの設定のコマンド（段階3）。入力の行を、画面の操作（ConfigAction）に読み替える純粋な関数。
// 書式（モードは持たない。ポート番号は行の中で指定する）:
//   ip address <ポート> <IP> <マスク>   例: ip address 0 192.168.1.10 255.255.255.0
//   ip default-gateway <IP>
//   ip route <宛先> <マスク> <次ホップ>
//   no ip default-gateway
//   no ip route <宛先> <マスク>
import type { Tr } from './terminal';
import type { Route } from './types';

export type ConfigAction =
  | { kind: 'iface'; port: number; ip: string; prefix: number }
  | { kind: 'gateway'; gateway: string | null }
  | { kind: 'addRoute'; route: Route }
  | { kind: 'removeRoute'; dest: string; prefix: number };

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

const port = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);

export const parseConfig = (line: string, tr: Tr): ConfigParse => {
  const words = line.trim().split(/\s+/).filter((w) => w !== '');
  const [first, ...rest] = words;
  if (first !== 'ip' && first !== 'no') return { kind: 'none' };
  const error = (key: string) => ({ kind: 'error' as const, text: tr(key) });

  if (first === 'ip' && rest[0] === 'address') {
    if (rest.length !== 4) return error('ui.terminal.usageIpAddress');
    const p = port(rest[1]);
    if (p === null) return error('ui.terminal.errPort');
    if (!isIp(rest[2])) return error('ui.terminal.errIp');
    const prefix = maskToPrefix(rest[3]);
    if (prefix === null) return error('ui.terminal.errMask');
    return { kind: 'action', action: { kind: 'iface', port: p, ip: rest[2], prefix } };
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
