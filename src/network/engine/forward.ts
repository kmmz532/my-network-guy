// 疎通の判定（ping・http）。往路と復路の判定は netState.ts の配送（deliver・backOf）を使う
import type { NetworkState } from './state';
import type { Topology } from '../netState';
import { backOf, deliver, fail, inSubnet, isPrivateIp, type Traffic } from '../netState';
import type { PathResult } from '../types';

// 静的 NAT（ポートの転送）: 外からルーターの外の口へのポートの通信を、社内のサーバーへ届ける。往路は外→外の口→社内の口→サーバー、復路は逆に戻す（N145）
const viaStatic = (topo: Topology, srcUid: string, routerUid: string, traffic: Traffic): PathResult | null => {
  const r = topo.node(routerUid);
  if (!r || traffic.kind !== 'http') return null;
  const map = r.statics?.find((s) => s.port === traffic.port);
  if (!map) return null;
  const outside = r.interfaces.find((i) => i.nat === 'outside');
  const inside = r.interfaces.find((i) => i.nat === 'inside' && inSubnet(map.insideIp, i.ip, i.prefix));
  const server = topo.allNodes().find((n) => n.interfaces.some((i) => i.ip === map.insideIp));
  if (!outside || !inside || !server) return { ok: false, path: [], failure: fail('route.none', routerUid) };
  const toRouter = deliver(topo, srcUid, routerUid, traffic, true, undefined, outside.ip);
  if (!toRouter.ok) return toRouter;
  const toServer = deliver(topo, routerUid, server.uid, { kind: 'http', port: map.insidePort }, false, inside.ip, map.insideIp);
  if (!toServer.ok) return { ok: false, path: toRouter.path, failure: toServer.failure };
  if (!server.services.some((s) => s.protocol === 'http' && s.port === map.insidePort)) return { ok: false, path: toRouter.path, failure: fail('service.closed', server.uid) };
  const back = deliver(topo, server.uid, routerUid, traffic, false, map.insideIp, inside.ip);
  if (!back.ok) return { ok: false, path: toRouter.path, failure: { reason: 'return.failed', node: server.uid, cause: back.failure } };
  return { ok: true, path: [...toRouter.path, ...toServer.path.slice(1)], staticNat: { router: routerUid, insideIp: map.insideIp, outsideIp: outside.ip } };
};

// Ping（ICMP）の判定。往路と復路の両方が通る必要がある
export const ping = (state: NetworkState, srcUid: string, dstUid: string): PathResult => {
  const topo = state.topology;
  const forward = deliver(topo, srcUid, dstUid, { kind: 'ping' });
  if (!forward.ok) return forward;
  const back = backOf(topo, dstUid, srcUid, { kind: 'ping' }, forward);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure }, nat: forward.nat };
  }
  return { ...forward, back: back.path };
};

// HTTP の判定。往路で宛先に届き、宛先が指定ポートでサービスを待ち受けていて、復路も通ること
export const http = (state: NetworkState, srcUid: string, dstUid: string, port: number): PathResult => {
  const topo = state.topology;
  // 外の口への通信が、静的 NAT で社内のサーバーへ届く場合（N145）
  const nat = viaStatic(topo, srcUid, dstUid, { kind: 'http', port });
  if (nat !== null) return nat;
  const forward = deliver(topo, srcUid, dstUid, { kind: 'http', port });
  if (!forward.ok) return forward;
  const dst = topo.node(dstUid);
  // 外から、NAT のルーターの外の口へ来た通信に、静的 NAT の転送先がない（nat.no_forward・NET.md §6）
  if (dst && dst.napt && dst.interfaces.some((i) => i.nat === 'outside') && !dst.statics?.some((s) => s.port === port)) {
    const srcIp = topo.node(srcUid)?.interfaces[0]?.ip;
    if (srcIp !== undefined && !isPrivateIp(srcIp)) return { ok: false, path: forward.path, failure: fail('nat.no_forward', dstUid) };
  }
  if (!dst || !dst.services.some((s) => s.protocol === 'http' && s.port === port)) {
    return { ok: false, path: forward.path, failure: fail('service.closed', dstUid) };
  }
  const back = backOf(topo, dstUid, srcUid, { kind: 'http', port }, forward);
  if (!back.ok) {
    return { ok: false, path: forward.path, failure: { reason: 'return.failed', node: dstUid, cause: back.failure }, nat: forward.nat };
  }
  return { ...forward, back: back.path };
};
