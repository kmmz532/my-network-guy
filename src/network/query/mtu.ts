// 通信の大きさと、区間の MTU。経路（deliver が求めた機器の列）の区間ごとに、通信が MTU に収まるか・分割されるか・分割禁止（DF）で止まるかを求める。
// 区間は path の隣り合う2台の間で、MTU は両端の口の MTU の小さい方（口の MTU の既定は 1500）。
// IPsec のトンネルの区間は、入口の WAN の口の MTU から、トンネルの包みの分（balance.json の vpn.overheadBytes）を引いた値。
import { balance } from 'virtual:game-data';
import { inSubnet } from '../ip';
import type { ForwardView } from '../engine/forward';
import { MTU_DEFAULT } from '../types';
import type { Iface, PathResult } from '../types';

// ping の既定の大きさ（バイト）。HTTP は 1500 で、DF は付かない
export const PING_SIZE = 100;
export const HTTP_SIZE = 1500;
// IP の見出し（分割したとき、各断片に付く）。MSS は TCP の見出し（20）と IP の見出し（20）を引いた値のため、adjust-mss の値に 40 を足したものが大きさ
const IP_HEADER = 20;
const MSS_HEADERS = 40;

// 通信の大きさ。df が true なら、区間の MTU を超えたとき分割せずに止める
export interface Probe {
  size: number;
  df: boolean;
}

export const pingProbe = (opts: { size?: number; df?: boolean } = {}): Probe => ({ size: opts.size ?? PING_SIZE, df: opts.df ?? false });

interface Leg {
  mtu: number;
  // この区間の両端の口（adjust-mss を読むため）
  ifaces: readonly Iface[];
}

// 区間の両端の口。隣り合う機器の、同じサブネットで同じ L2 ドメインにある口の組（最初に見つかった組）
const legIfaces = (view: ForwardView, a: string, b: string): [Iface, Iface] => {
  const na = view.addressing.nodeOf(a);
  const nb = view.addressing.nodeOf(b);
  if (!na || !nb) throw new Error(`MTU の計算: 機器がない ${a}-${b}`);
  for (const ia of na.interfaces) {
    if (ia.ip === '') continue;
    const members = view.l2.domainOf({ node: a, port: ia.port }).members;
    for (const ib of nb.interfaces) {
      if (ib.ip === '' || !inSubnet(ib.ip, ia.ip, ia.prefix)) continue;
      if (members.some((m) => m.node === b && m.port === ib.port)) return [ia, ib];
    }
  }
  throw new Error(`MTU の計算: 区間の口がない ${a}-${b}`);
};

const wanIface = (view: ForwardView, uid: string, ip: string): Iface => {
  const iface = view.addressing.nodeOf(uid)?.interfaces.find((i) => i.ip === ip);
  if (!iface) throw new Error(`MTU の計算: トンネルの WAN の口がない ${uid} ${ip}`);
  return iface;
};

const mtuOf = (i: Iface): number => i.mtu ?? MTU_DEFAULT;

const legsOf = (view: ForwardView, path: readonly string[], tunnel: PathResult['tunnel']): Leg[] =>
  path.slice(1).map((to, k) => {
    const from = path[k];
    if (tunnel && ((from === tunnel.ingress && to === tunnel.egress) || (from === tunnel.egress && to === tunnel.ingress))) {
      const forwardWay = from === tunnel.ingress;
      const entry = wanIface(view, from, forwardWay ? tunnel.ingressIp : tunnel.egressIp);
      const exit = wanIface(view, to, forwardWay ? tunnel.egressIp : tunnel.ingressIp);
      return { mtu: mtuOf(entry) - balance.vpn.overheadBytes, ifaces: [entry, exit] };
    }
    const [ia, ib] = legIfaces(view, from, to);
    return { mtu: Math.min(mtuOf(ia), mtuOf(ib)), ifaces: [ia, ib] };
  });

export interface MtuResult {
  // 区間ごとの分割の数（分割がなければ持たない）
  fragments?: number[];
  // DF で止まった区間の番号（path の中で、その区間の入口の機器の位置）
  blockedAt?: number;
}

// 経路（path）を通る通信が、区間の MTU に収まるか。kind が http のときは、通る口の adjust-mss で大きさを抑える
export const mtuAlong = (view: ForwardView, path: readonly string[], tunnel: PathResult['tunnel'], probe: Probe, kind: 'ping' | 'http'): MtuResult => {
  // 口の MTU の設定も、トンネルも、1500 を超える大きさもなければ、どの区間も収まる（既定の MTU は 1500）
  const custom = path.some((uid) => view.addressing.nodeOf(uid)?.interfaces.some((i) => i.mtu !== undefined || i.adjustMss !== undefined));
  if (!custom && !tunnel && probe.size <= MTU_DEFAULT) return {};
  const legs = legsOf(view, path, tunnel);
  const mss = kind === 'http' ? legs.flatMap((l) => l.ifaces.flatMap((i) => (i.adjustMss === undefined ? [] : [i.adjustMss + MSS_HEADERS]))) : [];
  const size = Math.min(probe.size, ...mss);
  const fragments: number[] = [];
  // いま運んでいる断片の大きさと、断片の数。分割は、その時までの最も小さい MTU に合わせて、全体を切り直す
  let unit = size;
  let count = 1;
  for (let i = 0; i < legs.length; i++) {
    if (legs[i].mtu < unit) {
      if (probe.df) return { blockedAt: i };
      unit = legs[i].mtu;
      count = Math.ceil((size - IP_HEADER) / (Math.floor((unit - IP_HEADER) / 8) * 8));
    }
    fragments.push(count);
  }
  return fragments.some((n) => n > 1) ? { fragments } : {};
};
