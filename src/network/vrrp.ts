// VRRP の規則（純粋関数）: 有効な優先度・マスターの選出・仮想 MAC
import { ipToInt } from './engine';

export const VRRP_DEFAULT_PRIORITY = 100;
// アドレスの所有者（仮想の IP アドレスと実の IP アドレスが同じ）の優先度
export const VRRP_OWNER_PRIORITY = 255;

export interface VrrpGroup {
  // 1〜255
  vrid: number;
  // 仮想の IP アドレス（インターフェースのサブネットの中）
  ip: string;
  // 1〜254。既定 100
  priority: number;
  // 既定 true
  preempt: boolean;
  // 追跡するインターフェース（id）と、止まったときに下げる値
  track?: { iface: string; decrement: number }[];
}

// 仮想 MAC（00:00:5e:00:01:<VRID の16進2桁>）。ゲームの MAC の表記（コロン区切り）に合わせる
export const vrrpMac = (vrid: number): string => `00:00:5e:00:01:${vrid.toString(16).padStart(2, '0')}`;

export interface VrrpMember {
  uid: string;
  // 実の IP アドレス
  realIp: string;
  group: VrrpGroup;
  // 追跡のインターフェースのうち、止まっているものの id
  downTracked: string[];
  // そのインターフェースが動いている（停止・断線でない）
  up: boolean;
}

// 有効な優先度。アドレスの所有者は 255。それ以外は priority から、止まっている追跡の decrement を引く（下限 1）
export const effectivePriority = (m: VrrpMember): number => {
  if (m.group.ip === m.realIp) return VRRP_OWNER_PRIORITY;
  const down = (m.group.track ?? []).filter((t) => m.downTracked.includes(t.iface)).reduce((sum, t) => sum + t.decrement, 0);
  return Math.max(1, m.group.priority - down);
};

// マスターの選出。動いているものの中で、有効な優先度が最大、同じなら実の IP アドレスが最大。
// previous（直前のマスター）が preempt なしで、まだ動いていれば、そのまま。全員が止まっていれば null
export const electVrrpMaster = (members: VrrpMember[], previous: string | null = null): string | null => {
  const alive = members.filter((m) => m.up);
  if (alive.length === 0) return null;
  const best = [...alive].sort((a, b) => effectivePriority(b) - effectivePriority(a) || ipToInt(b.realIp) - ipToInt(a.realIp))[0];
  const prev = previous === null ? undefined : alive.find((m) => m.uid === previous);
  if (prev && prev.group.preempt === false && best.uid !== prev.uid) return prev.uid;
  return best.uid;
};
