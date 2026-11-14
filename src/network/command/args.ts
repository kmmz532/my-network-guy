// 命令の引数の読み取りに使う共通の関数。
import { isValidHostname } from '../hostname';
import { ifacePrefixOf } from '../iface';
import { portCountOf } from '../../registry/query';
import type { NetNode } from '../types';
import type { ArgKind, TerminalSession } from './types';

// 口の番号から、機器のインターフェースの id を引く。その番号の口がなければ null
export const ifaceIdOf = (node: NetNode, port: number): string | null => node.interfaces.find((i) => i.port === port)?.id ?? null;

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

export const port = (s: string): number | null => (/^\d+$/.test(s) ? Number(s) : null);
// VLAN の番号（1〜4094）
export const vlanNumber = (s: string): number | null => (/^\d+$/.test(s) && Number(s) >= 1 && Number(s) <= 4094 ? Number(s) : null);

// interface の後ろの名前を、対象のインターフェースに直す。口の名前は機器の種類の接頭辞（iface.ts）に合わせ、
// g0/1・gi0/1・gigabitethernet0/1（ネットワーク機器）と eth0（端末）を読む。vlan10 は SVI。読めない名前・ない口は null
export const parseIfaceName = (device: string, text: string): TerminalSession['iface'] => {
  const svi = /^vlan(\d+)$/i.exec(text);
  if (svi !== null) {
    const vlan = vlanNumber(svi[1]);
    return vlan === null ? null : { kind: 'svi', vlan };
  }
  const m = (ifacePrefixOf(device) === 'eth' ? /^eth(\d+)$/i : /^(?:g|gi|gigabitethernet)0\/(\d+)$/i).exec(text);
  if (m === null || Number(m[1]) >= portCountOf(device)) return null;
  return { kind: 'port', port: Number(m[1]) };
};

// マスク（255.255.255.0）をプレフィックス長に直す。isArg('mask', …) を通った語にだけ使う。通っていなければ例外にする
export const prefixOfMask = (mask: string): number => {
  const prefix = maskToPrefix(mask);
  if (prefix === null) throw new Error(`マスクの形でない: ${mask}`);
  return prefix;
};

const rangeOk = (s: string, min: number, max: number): boolean => /^\d{1,10}$/.test(s) && Number(s) >= min && Number(s) <= max;
const VLAN_LIST_RE = /^\d+(-\d+)?(,\d+(-\d+)?)*$/;

// VLAN の一覧（10,20・10-12）を番号の並びに直す。範囲の両端が逆・範囲外の番号があれば null
export const vlanListOf = (text: string): number[] | null => {
  if (!VLAN_LIST_RE.test(text)) return null;
  const list: number[] = [];
  for (const part of text.split(',')) {
    const [from = '', to = from] = part.split('-');
    const lo = vlanNumber(from);
    const hi = vlanNumber(to);
    if (lo === null || hi === null || lo > hi) return null;
    for (let v = lo; v <= hi; v++) list.push(v);
  }
  return list;
};

// 語が、引数の型の形に合うか。形だけを見る（口が機器にあるか・経路があるかなどの中身は、命令の run が検査する）
export const isArg = (kind: ArgKind, text: string): boolean => {
  switch (kind) {
    case 'iface': return /^(?:(?:g|gi|gigabitethernet)0\/\d+|eth\d+|vlan\d+)$/i.test(text);
    case 'ip': return isIp(text);
    case 'mask': return maskToPrefix(text) !== null;
    case 'wildcard': {
      // マスクを反転した形（0.0.0.255）。連続した0の後に1が続く
      if (!isIp(text)) return false;
      const bits = text.split('.').map((x) => Number(x).toString(2).padStart(8, '0')).join('');
      return /^0*1*$/.test(bits);
    }
    case 'prefix': return rangeOk(text, 0, 32);
    case 'vlan': return vlanNumber(text) !== null;
    case 'vlanList': return vlanListOf(text) !== null;
    case 'area': return rangeOk(text, 0, 4294967295);
    case 'asn': return rangeOk(text, 1, 4294967295);
    case 'number': return /^\d{1,10}$/.test(text);
    case 'word': return text !== '';
    case 'hostname': return isHostName(text);
    case 'hostOrIp': return isIp(text) || (!/^[\d.]+$/.test(text) && isHostName(text));
  }
};
