// 命令の引数の読み取りに使う共通の関数。
import { isValidHostname } from '../hostname';
import { ifacePrefixOf } from '../iface';
import { portCountOf } from '../../registry/query';
import type { NetNode } from '../types';
import type { TerminalSession } from './types';

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
