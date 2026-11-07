// ホスト名（N68）。機器が自分で名乗る名前。英字で始まり、英数字とハイフンだけ（RFC 952。63文字以下、末尾はハイフンにしない）。
// 新しい機器には「種類の略号-番号」を自動で付ける（例: R-1、SW-1、PC-3）。番号は、同じ略号のホスト名の最大の番号に1を足す。
import type { NetNode } from './types';

const HOSTNAME_RE = /^[A-Za-z][A-Za-z0-9-]{0,62}$/;

// ホスト名の形の検査
export const isValidHostname = (s: string): boolean => HOSTNAME_RE.test(s) && !s.endsWith('-');

// 種類の略号（ホスト名の先頭に付ける）
const ABBR: Record<string, string> = {
  pc: 'PC',
  server: 'SRV',
  l2_switch: 'SW',
  l3_switch: 'L3',
  router: 'R',
  router_switch: 'RSW',
  home_router: 'HR',
  firewall: 'FW',
  printer: 'PRN',
  access_point: 'AP',
};

export const hostLabelOf = (category: string): string => {
  const abbr = ABBR[category];
  if (!abbr) throw new Error(`ホスト名の略号がない種類: ${category}`);
  return abbr;
};

// 新しい機器のホスト名。同じ略号のホスト名の番号の最大に1を足す（削除しても番号は重ならない）
export const nextHostname = (nodes: readonly NetNode[], category: string): string => {
  const label = hostLabelOf(category);
  const prefix = label + '-';
  let max = 0;
  for (const n of nodes) {
    const rest = n.hostname?.startsWith(prefix) ? n.hostname.slice(prefix.length) : '';
    if (/^[0-9]+$/.test(rest)) max = Math.max(max, Number(rest));
  }
  return `${label}-${max + 1}`;
};
