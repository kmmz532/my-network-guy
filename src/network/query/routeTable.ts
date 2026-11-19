// 機器の経路表（純粋関数）: show ip route と、機器の画面の経路の欄が同じ行を使う。直結・既定のゲートウェイ・静的・動的（RIP・OSPF・BGP）の順に並べる
import type { NetworkState } from '../engine/state';
import { adOf } from '../engine/stages/routing';
import { networkAddress } from '../segments';
import type { NetNode } from '../types';
import { learnedRoutesOf } from './learnedRoutes';

export type RouteRow =
  | { source: 'connected'; dest: string; prefix: number; port: number }
  | {
      source: 'static' | 'rip' | 'ospf' | 'ospfIa' | 'bgp';
      dest: string;
      prefix: number;
      nextHop: string;
      ad: number;
      metric: number;
      // 機器の設定した静的経路の添字（node.routes の添字）。消せるのは静的経路の行だけ。既定のゲートウェイと動的経路は null
      routeIndex: number | null;
    };

export const routeTableOf = (state: NetworkState, node: NetNode): RouteRow[] => {
  const rows: RouteRow[] = node.interfaces.map((i) => ({ source: 'connected', dest: networkAddress(i.ip, i.prefix), prefix: i.prefix, port: i.port }));
  // 静的経路の管理距離は 1（既定の経路も同じ）
  const staticAd = adOf({ dest: '', prefix: 0, nextHop: '', protocol: 'static' });
  if (node.gateway) rows.push({ source: 'static', dest: '0.0.0.0', prefix: 0, nextHop: node.gateway, ad: staticAd, metric: 0, routeIndex: null });
  node.routes.forEach((r, i) => rows.push({ source: 'static', dest: r.dest, prefix: r.prefix, nextHop: r.nextHop, ad: staticAd, metric: 0, routeIndex: i }));
  for (const protocol of ['rip', 'ospf', 'bgp'] as const) {
    for (const r of learnedRoutesOf(state, node.uid, protocol)) {
      const source = protocol === 'ospf' && r.interArea ? 'ospfIa' : protocol;
      rows.push({ source, dest: r.dest, prefix: r.prefix, nextHop: r.nextHop, ad: adOf(r), metric: r.metric ?? 0, routeIndex: null });
    }
  }
  return rows;
};

// 行の頭の印（show ip route と同じ）。既定の経路は S*
export const routeCodeOf = (row: RouteRow): string => {
  switch (row.source) {
    case 'connected':
      return 'C';
    case 'static':
      return row.prefix === 0 ? 'S*' : 'S';
    case 'rip':
      return 'R';
    case 'ospf':
      return 'O';
    case 'ospfIa':
      return 'O IA';
    case 'bgp':
      return 'B';
  }
};
