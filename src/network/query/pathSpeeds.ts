// Ping の通り道（結果の path）の区間ごとの速さ。達成条件 min_speed が使う
import { INTERNET_DEVICE } from '../../registry/query';
import { WIFI_LINK_PREFIX } from '../engine/stages/links';
import type { NetworkState } from '../engine/state';
import type { NetLink } from '../types';

export interface HopSpeed {
  from: string;
  to: string;
  // 区間の速さ（Mbps）。無線だけの区間・速さを持たない区間は含めない
  mbps: number;
}

// 配線の速さ。無線の仮想の配線・インターネットの仮想の機器への配線は null（速さで区切らない）
const speedOfLink = (state: NetworkState, l: NetLink, byDevice: ReadonlyMap<string, string>): number | null => {
  if (l.uid.startsWith(WIFI_LINK_PREFIX) || byDevice.get(l.a.node) === INTERNET_DEVICE || byDevice.get(l.b.node) === INTERNET_DEVICE) return null;
  const rep = state.links.lag.representative.get(l.uid);
  const speed = rep === undefined ? state.links.speeds.get(l.uid) : state.links.lagSpeeds.get(rep);
  if (speed === undefined) throw new Error(`配線の速さがない: ${l.uid}`);
  return speed;
};

// 区間の中の1本の配線を、from から to の向きに通る1歩。速さ（Mbps）は無線・速さを持たない配線では null
export interface RouteStep {
  link: NetLink;
  from: { node: string; port: number };
  to: { node: string; port: number };
  mbps: number | null;
  // まとまった論理リンクのメンバーなら、そのまとまりを代表する配線の uid（容量はまとまり全体で数える）
  lag: string | null;
}

// 隣り合う2台の間の速さ。間に L2 スイッチなどの中継の機器があれば、配線をたどった最も遅い配線がその道の速さで、
// 道が複数あれば（まとまっていない配線が並ぶ・迂回がある）最も速い道を取る（通る配線はスパニングツリーなどで決まり、ここでは選べないため）。
// 速さを持つ配線が1本もない道（無線だけ）は null
const hopRoute = (state: NetworkState, a: string, b: string): { mbps: number | null; steps: RouteStep[] } => {
  const byDevice = new Map(state.net.nodes.map((n) => [n.uid, n.device]));
  // net には無線の仮想の配線が入る。入力の配線の uid は speeds の鍵と同じ
  const wired = state.input.links.filter((l) => !l.uid.startsWith(WIFI_LINK_PREFIX));
  const links = [...wired, ...state.net.links.filter((l) => l.uid.startsWith(WIFI_LINK_PREFIX))];
  // 最も広い道（道の中の最も遅い配線の速さを、最大にする）。無制限は Infinity
  const best = new Map<string, number>([[a, Infinity]]);
  const via = new Map<string, { prev: string; step: RouteStep }>();
  const queue: string[] = [a];
  for (let head = 0; head < queue.length; head++) {
    const here = queue[head];
    const width = best.get(here)!;
    // a・b 以外の機器は、中継の口を出入りするときだけ通れる。b から先へは進まない
    if (here === b) continue;
    for (const l of links) {
      const end = l.a.node === here ? { self: l.a, peer: l.b } : l.b.node === here ? { self: l.b, peer: l.a } : null;
      if (end === null) continue;
      if (state.links.isShut(end.self.node, end.self.port) || state.links.isShut(end.peer.node, end.peer.port)) continue;
      if (here !== a && !state.l2.isRelay(end.self.node, end.self.port)) continue;
      if (end.peer.node !== b && !state.l2.isRelay(end.peer.node, end.peer.port)) continue;
      const speed = speedOfLink(state, l, byDevice);
      const next = Math.min(width, speed ?? Infinity);
      if (next > (best.get(end.peer.node) ?? -1)) {
        best.set(end.peer.node, next);
        via.set(end.peer.node, { prev: here, step: { link: l, from: { node: here, port: end.self.port }, to: { node: end.peer.node, port: end.peer.port }, mbps: speed, lag: state.links.lag.representative.get(l.uid) ?? null } });
        queue.push(end.peer.node);
      }
    }
  }
  const found = best.get(b);
  const steps: RouteStep[] = [];
  for (let at = b; at !== a; ) {
    const v = via.get(at);
    if (v === undefined) return { mbps: null, steps: [] };
    steps.unshift(v.step);
    at = v.prev;
  }
  return { mbps: found === undefined || found === Infinity ? null : found, steps };
};

// 隣り合う2台の間を通る配線（最も広い道。無線の区間も含む）。道がなければ空
export const hopStepsOf = (state: NetworkState, a: string, b: string): RouteStep[] => hopRoute(state, a, b).steps;

// 隣り合う2台の間の速さ（hopRoute の速さ）
const hopSpeed = (state: NetworkState, a: string, b: string): number | null => hopRoute(state, a, b).mbps;

// 通り道の隣り合う2台ごとの速さ
export const hopSpeedsOf = (state: NetworkState, path: readonly string[]): HopSpeed[] => {
  const out: HopSpeed[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const mbps = hopSpeed(state, path[i], path[i + 1]);
    if (mbps !== null) out.push({ from: path[i], to: path[i + 1], mbps });
  }
  return out;
};
