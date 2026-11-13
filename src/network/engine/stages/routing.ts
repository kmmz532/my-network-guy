// 経路の層: 機器ごとの経路表（静的・RIP・OSPF・BGP）、OSPF の隣接、BGP のセッション。直結のサブネットは経路表に入れず、転送が口のアドレスから判定する。
// 実効の構成（アドレスの層の net）と L2 の層だけから求める。経路の計算は、最初に読まれたときに1回だけ行う
import { isRoutingCategory } from '../../category';
import { computeBgp, type BgpEnv, type BgpResult } from '../../bgp';
import { inSubnet, networkOf } from '../../ip';
import { ospfMismatch, type OspfMismatch } from '../../ospf';
import type { Iface, NetNode, Network, Route } from '../../types';
import { deviceCategory } from '../../../registry/query';
import type { L2Layer } from './l2';

// OSPF の隣接の候補（同じサブネットで OSPF に参加した相手のルーターの口）。条件が合わなければ mismatch に理由を持つ
export interface OspfPeer {
  uid: string;
  ip: string;
  port: number;
  neighborIp: string;
  mismatch: OspfMismatch | null;
}

export interface RoutingLayer {
  // 機器の経路表。設定した静的経路の後に、RIP・OSPF・BGP で覚えた経路が続く（静的経路の出どころは省略されることがある）
  routesOf(uid: string): Route[];
  // BGP の計算結果（セッション・候補の経路）。BGP を動かしていない機器は undefined
  bgpOf(uid: string): BgpResult | undefined;
  // OSPF の隣接の候補
  ospfPeersOf(uid: string): OspfPeer[];
}

// 経路の管理距離（AD）。static 1・OSPF 110・RIP 120・eBGP 20・iBGP 200
export const adOf = (r: Route): number => (r.protocol === 'ospf' ? 110 : r.protocol === 'rip' ? 120 : r.protocol === 'bgp' ? (r.ibgp ? 200 : 20) : 1);

export const stageRouting = (net: Network, l2: L2Layer): RoutingLayer => {
  const nodes = new Map<string, NetNode>();
  for (const node of net.nodes) nodes.set(node.uid, node);
  const isRouter = (uid: string): boolean => {
    const node = nodes.get(uid);
    return node !== undefined && isRoutingCategory(deviceCategory(node.device));
  };

  // 動的経路（RIP・OSPF の MVP）。RIP・OSPF に参加したインターフェースどうしが、同じ L2 ドメインでつながる隣接をたどり、
  // 宛先のサブネットへの経路を作る。RIP は跳ね数（16 以上は届かない）、OSPF はコストの合計の最短経路（エリア 0 だけ）。
  // 参加していない機器・インターフェースは、経路を作らない
  const dynamicRoutes = (): Map<string, Route[]> => {
    const out = new Map<string, Route[]>();
    const routers = [...nodes.values()].filter((n) => isRouter(n.uid));
    for (const proto of ['rip', 'ospf'] as const) {
      const joined = (i: Iface): boolean => (proto === 'rip' ? i.rip === true : i.ospf !== undefined);
      // 隣接（同じサブネットで、両方が参加している）。辺は相手の機器と、こちらの口の番号と、相手の口のアドレス
      const adj = new Map<string, { to: string; cost: number; nextHop: string }[]>();
      for (const r of routers) {
        for (const i of r.interfaces) {
          if (!joined(i)) continue;
          for (const m of l2.domainOf({ node: r.uid, port: i.port }).members) {
            if (m.node === r.uid) continue;
            const other = nodes.get(m.node);
            if (!other || !isRouter(other.uid)) continue;
            const oi = other.interfaces.find((x) => x.port === m.port);
            if (!oi || !joined(oi) || !inSubnet(oi.ip, i.ip, i.prefix)) continue;
            // OSPF の隣接は、同じエリアの口どうしだけ（エリアが違えば隣接しない・N142）
            if (proto === 'ospf' && ospfMismatch(i, oi) !== null) continue;
            const cost = proto === 'rip' ? 1 : (i.ospf?.cost ?? 1);
            (adj.get(r.uid) ?? adj.set(r.uid, []).get(r.uid)!).push({ to: other.uid, cost, nextHop: oi.ip });
          }
        }
      }
      for (const r of routers) {
        // 自分のインターフェース（参加している）と同じサブネットは、直結の経路として扱うため、経路を作らない
        const own = r.interfaces.filter(joined);
        // 最短経路（Bellman-Ford。機器は少ない）。最初の一歩の相手のアドレスを覚える
        const dist = new Map<string, number>([[r.uid, 0]]);
        const first = new Map<string, string>();
        for (let round = 0; round < nodes.size; round++) {
          let changed = false;
          for (const [from, edges] of adj) {
            const d = dist.get(from);
            if (d === undefined) continue;
            for (const e of edges) {
              const nd = d + e.cost;
              if (dist.get(e.to) === undefined || nd < (dist.get(e.to) as number)) {
                dist.set(e.to, nd);
                first.set(e.to, from === r.uid ? e.nextHop : (first.get(from) as string));
                changed = true;
              }
            }
          }
          if (!changed) break;
        }
        const routes: Route[] = [];
        for (const o of routers) {
          if (o.uid === r.uid || dist.get(o.uid) === undefined) continue;
          const hop = first.get(o.uid);
          if (hop === undefined) continue;
          const metric = dist.get(o.uid) as number;
          // 既定の経路の配布（default-information originate）: 配る機器への最短の道を、0.0.0.0/0 の経路にする
          if (proto === 'ospf' && o.ospf?.defaultOriginate === true) routes.push({ dest: '0.0.0.0', prefix: 0, nextHop: hop, protocol: 'ospf', metric });
          // RIP は 16 以上で届かない（rip.unreachable）
          if (proto === 'rip' && metric >= 16) continue;
          for (const oi of o.interfaces) {
            if (!joined(oi)) continue;
            if (own.some((x) => inSubnet(oi.ip, x.ip, x.prefix))) continue;
            const interArea = proto === 'ospf' && !own.some((x) => x.ospf?.area === oi.ospf?.area);
            routes.push({ dest: networkOf(oi.ip, oi.prefix), prefix: oi.prefix, nextHop: hop, protocol: proto, metric, ...(interArea ? { interArea: true } : {}) });
          }
        }
        out.set(r.uid, [...(out.get(r.uid) ?? []), ...routes]);
      }
    }
    return out;
  };

  // eBGP（MVP）。相手の AS と、お互いの設定（neighbor）が合い、直接つながっていれば隣接（セッション）になる。
  // 各機器は自分の network 文の宛先を AS パス [自分の AS] で広告し、受け取った経路は自分の AS を含まないものだけ使う。短い AS パスを選ぶ。
  // 静的・RIP・OSPF の経路が決まった後に求め、BGP で覚えた経路を足す
  const bgpRoutes = (out: Map<string, Route[]>): Map<string, BgpResult> => {
    const routers = [...nodes.values()].filter((n) => n.bgp !== undefined && isRouter(n.uid));
    const igp = (r: NetNode): Route[] => [...r.routes, ...(out.get(r.uid) ?? [])];
    const covers = (ip: string, route: Route) => inSubnet(ip, route.dest, route.prefix);
    const env: BgpEnv = {
      direct: (r, ip) =>
        r.interfaces.some(
          (i) => inSubnet(ip, i.ip, i.prefix) && l2.domainOf({ node: r.uid, port: i.port }).members.some((m) => nodes.get(m.node)?.interfaces.some((x) => x.ip === ip)),
        ),
      reaches: (r, ip) => r.interfaces.some((i) => inSubnet(ip, i.ip, i.prefix)) || igp(r).some((route) => covers(ip, route)),
    };
    const result = computeBgp(routers, env);
    for (const r of routers) {
      const own = r.interfaces;
      const routes: Route[] = [];
      for (const c of result.get(r.uid)!.candidates) {
        if (!c.best || c.local || c.nextHop === null) continue;
        if (own.some((i) => inSubnet(c.dest, i.ip, i.prefix))) continue;
        // ネクストホップが直結でなければ、それを覆す経路（静的・OSPF・RIP）の次のホップに置き換える
        const direct = own.some((i) => inSubnet(c.nextHop!, i.ip, i.prefix));
        const via = direct ? undefined : igp(r).filter((route) => covers(c.nextHop!, route)).sort((a, b) => b.prefix - a.prefix)[0];
        routes.push({ dest: c.dest, prefix: c.prefix, nextHop: via ? via.nextHop : c.nextHop, protocol: 'bgp', metric: c.path.length, ...(c.ebgp ? {} : { ibgp: true }) });
      }
      out.set(r.uid, [...(out.get(r.uid) ?? []), ...routes]);
    }
    return result;
  };

  let computed: { dynamic: Map<string, Route[]>; bgp: Map<string, BgpResult> } | undefined;
  const compute = () => {
    if (computed === undefined) {
      const dynamic = dynamicRoutes();
      const bgp = bgpRoutes(dynamic);
      computed = { dynamic, bgp };
    }
    return computed;
  };

  return {
    routesOf: (uid) => [...(nodes.get(uid)?.routes ?? []), ...(compute().dynamic.get(uid) ?? [])],
    bgpOf: (uid) => compute().bgp.get(uid),
    ospfPeersOf: (uid) => {
      const r = nodes.get(uid);
      if (!r) return [];
      const out: OspfPeer[] = [];
      for (const i of r.interfaces) {
        if (i.ospf === undefined) continue;
        for (const m of l2.domainOf({ node: r.uid, port: i.port }).members) {
          if (m.node === r.uid) continue;
          const other = nodes.get(m.node);
          if (!other || !isRouter(other.uid)) continue;
          const oi = other.interfaces.find((x) => x.port === m.port);
          if (!oi || oi.ospf === undefined || !inSubnet(oi.ip, i.ip, i.prefix)) continue;
          out.push({ uid: other.uid, ip: i.ip, port: i.port, neighborIp: oi.ip, mismatch: ospfMismatch(i, oi) });
        }
      }
      return out;
    },
  };
};
