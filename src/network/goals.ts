import { dhcpOf } from './query/dhcp';
import { getComponent } from './components';
import { can } from './capabilities';
// 案件の達成条件（goals）の判定ハンドラ。種類ごとにハンドラを登録し、案件データから呼び出す。
import type { Contract, Flow, Goal } from '../data/schema';
import { http, ping, wirelessAssociations } from './engine';
import { reach } from './engine/forward';
import { healthyMembers } from './query/loadBalancer';
import { accessPointsOf } from './engine/stages/links';
import { lagBundlesOf } from './query/lagBundles';
import { channelOverlapsOf } from './query/channelOverlaps';
import { interferedAccessPointsOf } from './query/wirelessQuality';
import { hopSpeedsOf } from './query/pathSpeeds';
import { qosOf } from './query/qos';
import { seenIpOf } from './query/seenSources';
import { ospfNeighborsOf } from './query/ospfNeighbors';
import { analyze } from './engine/analyze';
import type { NetworkState } from './engine/state';
import { bgpTableOf } from './query/bgpTable';
import { stpOf } from './query/stp';
import { UPLINK_ROUTER_PORT, outsideCheck, withInternet } from './external';
import { resolveName } from './resolve';
import { isPcCategory } from '../data/categories';
import type { EngineData, Failure, Network, PathResult } from './types';
import { deviceCategory } from '../registry/query';

export interface GoalResult {
  goal: Goal;
  ok: boolean;
  failure?: Failure;
  // 判定した経路（自動検収でパケットを流すために使う）
  kind: 'ping' | 'http';
  src: string;
  dst: string;
  result: PathResult;
  // 名前で引いた通信の名前（シーケンス図で DNS の問い合わせを出すため）
  name?: string;
  // ping の大きさ（バイト）と分割禁止。指定した達成条件だけが持つ
  size?: number;
  df?: boolean;
}

// flows は、案件・教材の同時に流れる通信（qos_voice だけが読む）
type Handler = (goal: Goal, state: NetworkState, flows?: readonly Flow[]) => GoalResult[];

const uidsOf = (net: Network, _data: EngineData, category: string): string[] =>
  net.nodes.filter((n) => deviceCategory(n.device) === category).map((n) => n.uid);

// 判定する機器がないときの不合格
const none = (goal: Goal, kind: 'ping' | 'http'): GoalResult => ({
  goal,
  ok: false,
  kind,
  src: '',
  dst: '',
  result: { ok: false, path: [] },
});

// 案件の placed[].ref は配置した機器のuidとして扱う
const handlers: { [K in Goal['type']]: Handler } = {
  ping: (goal, state) => {
    if (goal.type !== 'ping') throw new Error('ping ハンドラに別の種類が渡された');
    const r = ping(state, goal.from, goal.to, { size: goal.size, df: goal.df });
    return [{ goal, ok: r.ok, failure: r.failure, kind: 'ping', src: goal.from, dst: goal.to, result: r, ...(goal.size !== undefined ? { size: goal.size } : {}), ...(goal.df !== undefined ? { df: goal.df } : {}) }];
  },
  // 届き、通り道の区間の速さがすべて mbps 以上なら合格。遅い区間があれば、その区間の両端の機器ごとに speed.slow を返す。届かなければ Ping の失敗をそのまま返す
  min_speed: (goal, state) => {
    if (goal.type !== 'min_speed') throw new Error('min_speed ハンドラに別の種類が渡された');
    const r = ping(state, goal.from, goal.to);
    const base = { goal, kind: 'ping' as const, src: goal.from, dst: goal.to };
    if (!r.ok) return [{ ...base, ok: false, failure: r.failure, result: r }];
    const slow = hopSpeedsOf(state, r.path).filter((h) => h.mbps < goal.mbps);
    if (slow.length === 0) return [{ ...base, ok: true, result: r }];
    const nodes = [...new Set(slow.flatMap((h) => [h.from, h.to]))];
    return nodes.map((node) => ({ ...base, ok: false, failure: { reason: 'speed.slow' as const, node }, result: { ...r, ok: false } }));
  },
  // from から、ロードバランサーのその port の仮想サーバーへ HTTP が届き、健全な振り分け先が minHealthy 以上なら合格。届かなければ HTTP の失敗をそのまま、足りなければ lb.few_healthy（ロードバランサーに出す）
  load_balanced: (goal, state) => {
    if (goal.type !== 'load_balanced') throw new Error('load_balanced ハンドラに別の種類が渡された');
    const r = http(state, goal.from, goal.lb, goal.port);
    const base = { goal, kind: 'http' as const, src: goal.from, dst: goal.lb };
    if (!r.ok) return [{ ...base, ok: false, failure: r.failure, result: r }];
    const lb = state.addressing.nodeOf(goal.lb);
    const vs = lb ? getComponent(lb, 'loadBalancer')?.find((v) => v.port === goal.port && lb.interfaces.some((i) => i.ip === v.vip)) : undefined;
    if (!lb || !vs) throw new Error(`HTTP が届いたのに仮想サーバーがない: ${goal.lb}:${goal.port}`);
    if (healthyMembers(state, lb, vs, reach).length >= goal.minHealthy) return [{ ...base, ok: true, result: r }];
    return [{ ...base, ok: false, failure: { reason: 'lb.few_healthy' as const, node: goal.lb }, result: { ...r, ok: false } }];
  },
  // a から b への IPsec のトンネルが張れていれば合格。張れなければ、その理由を a に出す（a にトンネルがない、b を指すトンネルがないときは vpn.peer_unreachable）
  vpn_up: (goal, state) => {
    if (goal.type !== 'vpn_up') throw new Error('vpn_up ハンドラに別の種類が渡された');
    if (goal.a === undefined || goal.b === undefined) {
      const up = state.vpn.tunnels.find((t) => t.ok);
      const first = state.vpn.tunnels[0];
      const owner = first?.router ?? state.net.nodes.find((n) => can(n.device, 'vpn'))?.uid ?? '';
      const anyBase = { goal, kind: 'ping' as const, src: up?.router ?? owner, dst: up?.tunnel.peer ?? '', result: { ok: false, path: [] } };
      if (up) return [{ ...anyBase, ok: true, result: { ok: true, path: [] } }];
      return [{ ...anyBase, ok: false, failure: { reason: first && !first.ok ? first.reason : 'vpn.peer_unreachable', node: owner } }];
    }
    for (const uid of [goal.a, goal.b]) if (!state.net.nodes.some((n) => n.uid === uid)) throw new Error(`vpn_up の機器がない: ${uid}`);
    const peerNode = state.net.nodes.find((n) => n.uid === goal.b)!;
    const toward = state.vpn.tunnels.filter((t) => t.router === goal.a && peerNode.interfaces.some((i) => i.ip === t.tunnel.peer));
    const base = { goal, kind: 'ping' as const, src: goal.a, dst: goal.b, result: { ok: false, path: [] } };
    if (toward.some((t) => t.ok)) return [{ ...base, ok: true, result: { ok: true, path: [] } }];
    const first = toward[0];
    return [{ ...base, ok: false, failure: { reason: first && !first.ok ? first.reason : 'vpn.peer_unreachable', node: goal.a } }];
  },
  // インターネット側から、to の port へ HTTP が届けば合格。外から届く道は、回線につながるルーターの静的 NAT（外の port → 社内のアドレス）だけ。静的 NAT の先が to の IP アドレスでなければ届かない扱い
  public_http: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'public_http') throw new Error('public_http ハンドラに別の種類が渡された');
    const target = net.nodes.find((n) => n.uid === goal.to);
    if (!target) throw new Error(`public_http の宛先がない: ${goal.to}`);
    const unreachable = (src: string): GoalResult => ({ goal, ok: false, kind: 'http', src, dst: goal.to, failure: { reason: 'route.none', node: goal.to }, result: { ok: false, path: [] } });
    const withNet = withInternet(net, data);
    if (!withNet) return [unreachable('')];
    const view = analyze(withNet, data);
    const results = withNet.internetUids.map((isp): GoalResult => {
      const ispLink = withNet.links.find((l) => l.a.node === isp || l.b.node === isp);
      const uplinkUid = ispLink && (ispLink.a.node === isp ? ispLink.b.node : ispLink.a.node);
      const routerLink = withNet.links.find((l) => (l.a.node === uplinkUid && l.a.port === UPLINK_ROUTER_PORT) || (l.b.node === uplinkUid && l.b.port === UPLINK_ROUTER_PORT));
      const router = routerLink && (routerLink.a.node === uplinkUid ? routerLink.b.node : routerLink.a.node);
      if (!router) throw new Error(`回線終端の先のルーターがない: ${isp}`);
      const r = http(view, isp, router, goal.port);
      const base = { goal, kind: 'http' as const, src: isp, dst: goal.to };
      if (!r.ok) return { ...base, ok: false, failure: r.failure, result: r };
      if (!r.staticNat || !target.interfaces.some((i) => i.ip === r.staticNat!.insideIp)) return { ...unreachable(isp), result: { ...r, ok: false } };
      return { ...base, ok: true, result: r };
    });
    return [results.find((r) => r.ok) ?? results[0]];
  },
  // 指定した端末ごとに、インターネットへ HTTP で届けば合格。by があれば、インターネットから見た送信元が機器 by のアドレスであること（プロキシを通る通信の送信元は、プロキシのアドレス）。届かなければその失敗を返す
  outside_sees: (goal, state) => {
    if (goal.type !== 'outside_sees') throw new Error('outside_sees ハンドラに別の種類が渡された');
    const { net, world } = state;
    const withNet = withInternet(net, world);
    const by = goal.by === undefined ? undefined : net.nodes.find((n) => n.uid === goal.by);
    if (goal.by !== undefined && !by) throw new Error(`outside_sees の機器がない: ${goal.by}`);
    return goal.from.map((uid): GoalResult => {
      if (!net.nodes.some((n) => n.uid === uid)) throw new Error(`機器が見つからない: ${uid}`);
      if (!withNet) return { goal, ok: false, kind: 'http', src: uid, dst: '', failure: { reason: 'route.none', node: uid }, result: { ok: false, path: [] } };
      const view = analyze(withNet, world);
      const results = withNet.internetUids.map((isp) => ({ isp, r: http(view, uid, isp, goal.port) }));
      const hit = results.find((x) => x.r.ok) ?? results[0];
      const base = { goal, kind: 'http' as const, src: uid, dst: hit.isp, result: hit.r };
      if (!hit.r.ok) return { ...base, ok: false, failure: hit.r.failure };
      const seen = seenIpOf(net.nodes, uid, hit.r);
      return { ...base, ok: by === undefined || (seen !== undefined && by.interfaces.some((i) => i.ip === seen)) };
    });
  },
  // 指定した flow（省くと voice すべて）が、削られずに届けば合格。届かなければ Ping の失敗を、削られていれば qos.dropped を、削られた区間の入口の機器に出す
  qos_voice: (goal, state, flows) => {
    if (goal.type !== 'qos_voice') throw new Error('qos_voice ハンドラに別の種類が渡された');
    if (flows === undefined) throw new Error('qos_voice: 通信（flows）がない');
    const picked = goal.flow ?? flows.flatMap((f, i) => (f.kind === 'voice' ? [i] : []));
    if (picked.length === 0) throw new Error('qos_voice: 対象の通信がない');
    const bad = picked.find((i) => flows[i] === undefined);
    if (bad !== undefined) throw new Error(`qos_voice: 通信 ${bad} がない`);
    const outcomes = qosOf(state, flows);
    return picked.map((i) => {
      const o = outcomes[i];
      const base = { goal, kind: 'ping' as const, src: o.flow.from, dst: o.flow.to };
      if (!o.result.ok) return { ...base, ok: false, failure: o.result.failure, result: o.result };
      if (o.droppedAt !== null) return { ...base, ok: false, failure: { reason: 'qos.dropped' as const, node: o.droppedAt }, result: { ...o.result, ok: false } };
      return { ...base, ok: true, result: o.result };
    });
  },
  ping_all: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'ping_all') throw new Error('ping_all ハンドラに別の種類が渡された');
    // $all_pcs は、判定の時点でネットワークにあるPCすべてとする（自社案件）
    const nodes = goal.nodes === '$all_pcs' ? uidsOf(net, data, 'pc') : goal.nodes;
    // 疎通は往復で判定するため、組み合わせは順不同の全ペアで足りる
    const results: GoalResult[] = [];
    if (nodes.length < 2) return [none(goal, 'ping')];
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const r = ping(state, nodes[i], nodes[j]);
        results.push({ goal, ok: r.ok, failure: r.failure, kind: 'ping', src: nodes[i], dst: nodes[j], result: r });
      }
    }
    return results;
  },
  http: (goal, state) => {
    if (goal.type !== 'http') throw new Error('http ハンドラに別の種類が渡された');
    const r = http(state, goal.from, goal.to, goal.port);
    return [{ goal, ok: r.ok, failure: r.failure, kind: 'http', src: goal.from, dst: goal.to, result: r }];
  },
  count: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'count') throw new Error('count ハンドラに別の種類が渡された');
    const ok = uidsOf(net, data, goal.category).length >= goal.min;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 無線の端末が、アクセスポイントに一定数以上つながる（電波の範囲・SSID・パスワードで決まる。N152）
  wireless_clients: (goal, state) => {
    const { world: data } = state;
    if (goal.type !== 'wireless_clients') throw new Error('wireless_clients ハンドラに別の種類が渡された');
    const ok = wirelessAssociations(state.input, data).length >= goal.min;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // すべての PC どうしが届き、機器に設定した経路（static）がない（N143）
  no_static_route: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'no_static_route') throw new Error('no_static_route ハンドラに別の種類が渡された');
    const pcs = uidsOf(net, data, 'pc');
    const staticFree = net.nodes.every((n) => n.routes.every((r) => r.protocol !== undefined && r.protocol !== 'static'));
    let reach = pcs.length >= 2;
    for (let i = 0; i < pcs.length && reach; i++) for (let j = i + 1; j < pcs.length && reach; j++) reach = ping(state, pcs[i], pcs[j]).ok;
    const ok = staticFree && reach;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 指定したルーターの BGP の隣接が min 本以上確立している（回線の先の ISP も含めて数える）
  bgp_established: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'bgp_established') throw new Error('bgp_established ハンドラに別の種類が渡された');
    const withNet = withInternet(net, data) ?? net;
    const sessions = bgpTableOf(analyze(withNet, data), goal.node)?.sessions ?? [];
    const ok = sessions.filter((s) => s.status.state === 'established').length >= goal.min;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 指定した機器が、物理のリンク min 本以上を1本の論理リンクにまとめている
  lag_bundled: (goal, state) => {
    if (goal.type !== 'lag_bundled') throw new Error('lag_bundled ハンドラに別の種類が渡された');
    const ok = lagBundlesOf(state, goal.node).some((b) => b.links.length >= goal.min);
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 社内のすべての PC が、回線の先（インターネット）へ届く
  outside_reachable: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'outside_reachable') throw new Error('outside_reachable ハンドラに別の種類が渡された');
    // 回線終端につながるルーターは、NAPT（外側の口と内側の口・ip nat napt）を設定している
    const lineRouters = net.nodes.filter((n) => net.links.some((l) => (l.a.node === n.uid && net.nodes.some((u) => u.uid === l.b.node && deviceCategory(u.device) === 'uplink')) || (l.b.node === n.uid && net.nodes.some((u) => u.uid === l.a.node && deviceCategory(u.device) === 'uplink'))));
    const nat = lineRouters.length > 0 && lineRouters.every((r) => getComponent(r, 'nat')?.napt === true && r.interfaces.some((i) => i.nat === 'outside') && r.interfaces.some((i) => i.nat === 'inside'));
    const ok = nat && outsideCheck(net, data).pcsReachOutside;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 指定した SSID のアクセスポイントがすべて WPA2 以上で、無線の警告（暗号化なし・弱い暗号・移行モード）がない
  wireless_secure: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'wireless_secure') throw new Error('wireless_secure ハンドラに別の種類が渡された');
    const aps = accessPointsOf(net, data).filter((n) => getComponent(n, 'wireless')?.ssid === goal.ssid);
    const ok = aps.length > 0 && aps.every((n) => ['wpa2', 'wpa3', 'wpa2_eap', 'wpa3_eap'].includes(getComponent(n, 'wireless')?.security ?? 'wpa2'));
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // アクセスポイントがあり、どれもチャネルの重なりと干渉源の干渉がない
  wireless_clean: (goal, state) => {
    if (goal.type !== 'wireless_clean') throw new Error('wireless_clean ハンドラに別の種類が渡された');
    const overlapped = channelOverlapsOf(state).length > 0;
    const ok = accessPointsOf(state.input, state.world).length > 0 && !overlapped && interferedAccessPointsOf(state).size === 0;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 指定したスイッチがルートブリッジになっている
  stp_root: (goal, state) => {
    if (goal.type !== 'stp_root') throw new Error('stp_root ハンドラに別の種類が渡された');
    const ok = stpOf(state).root === goal.node;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 指定した機器のどれか1台の電源を切っても、残りの PC・サーバーがすべて互いに届く
  survive_device_failure: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'survive_device_failure') throw new Error('survive_device_failure ハンドラに別の種類が渡された');
    const ok = goal.nodes.every((uid) => {
      const off: Network = { ...net, nodes: net.nodes.map((n) => (n.uid === uid ? { ...n, powered: false } : n)) };
      const ends = off.nodes.filter((n) => n.uid !== uid && (isPcCategory(deviceCategory(n.device)) || deviceCategory(n.device) === 'server')).map((n) => n.uid);
      const after = analyze(off, data);
      for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) if (!ping(after, ends[i], ends[j]).ok) return false;
      // ロードバランサーの仮想サーバーへも、残りの PC から HTTP が届く
      const pcs = ends.filter((u) => isPcCategory(deviceCategory(off.nodes.find((n) => n.uid === u)!.device)));
      for (const lb of off.nodes.filter((n) => n.uid !== uid && n.powered !== false)) {
        for (const vs of getComponent(lb, 'loadBalancer') ?? []) {
          if (!lb.interfaces.some((i) => i.ip === vs.vip)) continue;
          if (!pcs.every((pc) => http(after, pc, lb.uid, vs.port).ok)) return false;
        }
      }
      return ends.length >= 2;
    });
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 回線終端が2つ以上あり、どれか1つ（とその配線）を除いても、すべての PC が外部へ届く
  survive_uplink_failure: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'survive_uplink_failure') throw new Error('survive_uplink_failure ハンドラに別の種類が渡された');
    const uplinks = net.nodes.filter((n) => deviceCategory(n.device) === 'uplink');
    const without = (uid: string): Network => ({ ...net, nodes: net.nodes.filter((n) => n.uid !== uid), links: net.links.filter((l) => l.a.node !== uid && l.b.node !== uid) });
    const ok = uplinks.length >= 2 && uplinks.every((u) => outsideCheck(without(u.uid), data).pcsReachOutside);
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // 指定した機器が DR になっている（同じネットワークの隣接の相手から見て、その機器が FULL/DR）
  ospf_dr: (goal, state) => {
    if (goal.type !== 'ospf_dr') throw new Error('ospf_dr ハンドラに別の種類が渡された');
    const peers = ospfNeighborsOf(state, goal.node);
    const ok = peers.some((p) => ospfNeighborsOf(state, p.uid).some((q) => q.uid === goal.node && q.state === 'FULL/DR'));
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  count_device: (goal, state) => {
    const { net } = state;
    if (goal.type !== 'count_device') throw new Error('count_device ハンドラに別の種類が渡された');
    const ok = net.nodes.filter((n) => n.device === goal.device).length >= goal.min;
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  // すべての PC が、そのカテゴリの機器のどれか1台へ届く（PC ごとに、届く機器のうち最初のものの結果）
  reach_category: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'reach_category') throw new Error('reach_category ハンドラに別の種類が渡された');
    const pcs = uidsOf(net, data, 'pc');
    const targets = uidsOf(net, data, goal.category);
    if (!pcs.length || !targets.length) return [none(goal, 'ping')];
    return pcs.map((pc) => {
      const tries = targets.map((t) => ({ t, r: ping(state, pc, t) }));
      const hit = tries.find((x) => x.r.ok) ?? tries[0];
      return { goal, ok: hit.r.ok, failure: hit.r.failure, kind: 'ping' as const, src: pc, dst: hit.t, result: hit.r };
    });
  },
  // すべての PC が、名前で指定の機器へ届く。PC ごとに名前を引き（対応表 → ネームサーバー）、引けた IPアドレスの機器へ Ping する（N68）
  reach_by_name: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'reach_by_name') throw new Error('reach_by_name ハンドラに別の種類が渡された');
    const pcs = uidsOf(net, data, 'pc');
    const target = net.nodes.find((n) => n.hostname === goal.name);
    if (!pcs.length || !target) return [none(goal, 'ping')];
    return pcs.map((pc) => {
      const from = net.nodes.find((n) => n.uid === pc);
      if (!from) throw new Error(`PC が見つからない: ${pc}`);
      const r = resolveName(from, goal.name, net, data);
      const dst = r.ok ? net.nodes.find((n) => n.interfaces.some((i) => i.ip === r.ip)) : undefined;
      if (!dst) {
        return { goal, ok: false, failure: { reason: 'name.unresolved' as const, node: pc }, kind: 'ping' as const, src: pc, dst: target.uid, result: { ok: false, path: [] } };
      }
      const result = ping(state, pc, dst.uid);
      return { goal, ok: result.ok, failure: result.failure, kind: 'ping' as const, src: pc, dst: dst.uid, result };
    });
  },
  // 指定の機器が名前を引き、引けた IP アドレスの機器へ HTTP する。名前は結果に持ち、シーケンス図で DNS の問い合わせを出す
  http_by_name: (goal, state) => {
    const { net, world } = state;
    if (goal.type !== 'http_by_name') throw new Error('http_by_name ハンドラに別の種類が渡された');
    return goal.from.map((uid) => {
      const from = net.nodes.find((n) => n.uid === uid);
      if (!from) throw new Error(`機器が見つからない: ${uid}`);
      const r = resolveName(from, goal.name, net, world);
      const dst = r.ok ? net.nodes.find((n) => n.interfaces.some((i) => i.ip === r.ip)) : undefined;
      if (!dst) return { goal, ok: false, failure: { reason: 'name.unresolved' as const, node: uid }, kind: 'http' as const, src: uid, dst: uid, result: { ok: false, path: [] }, name: goal.name };
      const result = http(state, uid, dst.uid, goal.port, goal.name);
      return { goal, ok: result.ok, failure: result.failure, kind: 'http' as const, src: uid, dst: dst.uid, result, name: goal.name };
    });
  },
  // 指定した機器ごとに名前を引く。引けて、ip の指定があればその IP アドレスなら合格
  resolve_name: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'resolve_name') throw new Error('resolve_name ハンドラに別の種類が渡された');
    return goal.from.map((uid) => {
      const from = net.nodes.find((n) => n.uid === uid);
      if (!from) throw new Error(`機器が見つからない: ${uid}`);
      const r = resolveName(from, goal.name, net, data);
      const ok = r.ok && (goal.ip === undefined || r.ip === goal.ip);
      const dst = r.server ?? uid;
      return { goal, ok, ...(ok ? {} : { failure: { reason: 'name.unresolved' as const, node: uid } }), kind: 'ping' as const, src: uid, dst, result: { ok, path: [] } };
    });
  },
  http_all: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'http_all') throw new Error('http_all ハンドラに別の種類が渡された');
    const pcs = uidsOf(net, data, 'pc');
    const servers = uidsOf(net, data, 'server');
    if (!pcs.length || !servers.length) return [none(goal, 'http')];
    return pcs.map((pc) => {
      // 最初に閲覧できたサーバーの経路を使う。どこにも届かなければ最初のサーバーの結果を返す
      const tries = servers.map((sv) => ({ sv, r: http(state, pc, sv, goal.port) }));
      const hit = tries.find((x) => x.r.ok) ?? tries[0];
      return { goal, ok: hit.r.ok, failure: hit.r.failure, kind: 'http' as const, src: pc, dst: hit.sv, result: hit.r };
    });
  },
  // 通ってはいけない通信: 往路がファイアウォールの規則で止められていること（ほかの理由で届かないだけでは合格にしない）
  blocked: (goal, state) => {
    if (goal.type !== 'blocked') throw new Error('blocked ハンドラに別の種類が渡された');
    const r = ping(state, goal.from, goal.to);
    const ok = !r.ok && r.failure?.reason === 'firewall.denied';
    return [{ goal, ok, failure: r.failure, kind: 'ping', src: goal.from, dst: goal.to, result: { ...r, ok } }];
  },
  // 指定した端末がすべて自動（DHCP）で、アドレスを受け取っている
  dhcp_all: (goal, state) => {
    const { net } = state;
    if (goal.type !== 'dhcp_all') throw new Error('dhcp_all ハンドラに別の種類が渡された');
    const r = dhcpOf(state);
    const ok = goal.nodes.every((uid) => {
      const n = net.nodes.find((x) => x.uid === uid);
      return n !== undefined && n.interfaces.length > 0 && n.interfaces.every((i) => i.dhcp === true) && r.leases.some((l) => l.uid === uid) && !r.failed.some((f) => f.uid === uid);
    });
    return [{ ...none(goal, 'ping'), ok, result: { ok, path: [] } }];
  },
  isolated: (goal, state) => {
    if (goal.type !== 'isolated') throw new Error('isolated ハンドラに別の種類が渡された');
    return goal.from.flatMap((src) =>
      goal.to.map((dst) => {
        const r = ping(state, src, dst);
        return { goal, ok: !r.ok, failure: r.failure, kind: 'ping' as const, src, dst, result: { ...r, ok: !r.ok } };
      }),
    );
  },
  http_from: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'http_from') throw new Error('http_from ハンドラに別の種類が渡された');
    const servers = uidsOf(net, data, 'server');
    if (!servers.length) return [none(goal, 'http')];
    return goal.nodes.map((src) => {
      const tries = servers.map((sv) => ({ sv, r: http(state, src, sv, goal.port) }));
      const hit = tries.find((x) => x.r.ok) ?? tries[0];
      return { goal, ok: hit.r.ok, failure: hit.r.failure, kind: 'http' as const, src, dst: hit.sv, result: hit.r };
    });
  },
  blocked_all: (goal, state) => {
    if (goal.type !== 'blocked_all') throw new Error('blocked_all ハンドラに別の種類が渡された');
    return goal.from.flatMap((src) =>
      goal.to.map((dst) => {
        const r = ping(state, src, dst);
        const ok = !r.ok && r.failure?.reason === 'firewall.denied';
        return { goal, ok, failure: r.failure, kind: 'ping' as const, src, dst, result: { ...r, ok } };
      }),
    );
  },
  firewall: (goal, state) => {
    const { net, world: data } = state;
    if (goal.type !== 'firewall') throw new Error('firewall ハンドラに別の種類が渡された');
    const pcs = uidsOf(net, data, 'pc');
    const servers = uidsOf(net, data, 'server');
    if (!pcs.length || !servers.length) return [none(goal, 'ping')];
    const firewalls = new Set(uidsOf(net, data, 'firewall'));
    // PC ごとに、届くすべてのサーバーへの経路にファイアウォールがあれば成立。どこにも届かなければ不成立
    return pcs.map((pc) => {
      const tries = servers.map((sv) => ({ sv, r: ping(state, pc, sv) }));
      const reached = tries.filter((x) => x.r.ok);
      const bare = reached.find((x) => !x.r.path.some((uid) => firewalls.has(uid)));
      const hit = bare ?? reached[0] ?? tries[0];
      const ok = reached.length > 0 && !bare;
      return { goal, ok, failure: hit.r.failure, kind: 'ping' as const, src: pc, dst: hit.sv, result: { ...hit.r, ok } };
    });
  },
};

// 1つの達成条件を判定する。ping_all は全ペアの結果を返す
export const evaluateGoal = (goal: Goal, state: NetworkState, flows?: readonly Flow[]): GoalResult[] => handlers[goal.type](goal, state, flows);

export interface ContractResult {
  passed: boolean;
  results: GoalResult[];
}

// 案件のすべての達成条件を判定する。すべて成立したときに合格とする
export const evaluateContract = (contract: Contract, state: NetworkState): ContractResult => {
  const results = contract.goals.flatMap((goal) => evaluateGoal(goal, state, contract.flows));
  return { passed: results.every((r) => r.ok), results };
};
