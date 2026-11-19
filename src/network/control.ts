// 制御のパケットの列（シーケンス図の元）。ping・http の結果（経路）と framesOf（frames.ts）、DNS の名前の解決（dns.ts）、DHCP・OSPF・STP・VRRP の既存の結果を並べるだけで、通信は計算し直さない。
// STP の BPDU だけは、スイッチ間の制御のため、スイッチが from・to になる。
// ARP の表は持たず、区間ごとに最初の通信の前に「初回」として出す。乱数は使わない。
import { deviceCategory } from '../registry/query';
import { can } from './capabilities';
import { isL2Category, isRoutingCategory } from './category';
import { getComponent } from './components';
import { lookupName, type DnsStep } from './dns';
import { analyze } from './engine/analyze';
import { deliver, dnsQuery, http, ping } from './engine/forward';
import type { Traffic } from './engine/forward';
import type { NetworkState } from './engine/state';
import { withInternet } from './external';
import { framesOf, type Frame, type FrameContext } from './frames';
import { inSubnet } from './engine';
import { l2Path } from './mac';
import { ospfNeighborsOf } from './query/ospfNeighbors';
import { effectivePriority, electVrrpMaster } from './vrrp';
import type { VpnFailure } from './query/vpn';
import type { Failure, NetNode, PathResult } from './types';

export type ControlTrigger =
  | { kind: 'ping'; from: string; to: string; size?: number; df?: boolean }
  | { kind: 'http'; from: string; to: string; port: number; name?: string }
  | { kind: 'dhcp'; client: string }
  | { kind: 'ospf'; a: string; b: string }
  | { kind: 'stp' }
  | { kind: 'vrrp'; group: number }
  | { kind: 'vpn'; a: string; b: string };

export interface ControlStep {
  from: string;
  // ブロードキャストのときは '*'
  to: string;
  // 届いた L3 の機器の uid（ユニキャストなら [to]）
  reached: string[];
  proto: 'arp' | 'icmp' | 'udp' | 'tcp' | 'dns' | 'http' | 'dhcp' | 'ospf' | 'stp' | 'vrrp' | 'ike';
  // 文言のキー（seq.*）と、その置換の値
  label: string;
  params?: Record<string, string | number>;
  // マップで流す機器の uid の列
  path: string[];
  frame?: Frame;
  // 最後の失敗の行だけが持つ
  failure?: Failure;
}

const nodeOf = (state: NetworkState, uid: string): NetNode => {
  const n = state.net.nodes.find((x) => x.uid === uid);
  if (!n) throw new Error(`制御の列: 機器がない ${uid}`);
  return n;
};

const frameCtx = (state: NetworkState): FrameContext => {
  const category = (uid: string) => deviceCategory(nodeOf(state, uid).device);
  return {
    nodes: state.net.nodes,
    links: state.net.links,
    categoryOf: deviceCategory,
    // L2 スイッチ・アクセスポイント・回線終端は、L3 の区間の途中
    isSwitch: (uid) => isL2Category(category(uid)) || can(nodeOf(state, uid).device, 'accessPoint') || can(nodeOf(state, uid).device, 'uplink'),
    isRouter: (uid) => isRoutingCategory(category(uid)),
  };
};

// 往路と復路のフレーム（framesOf は往路に復路を続けて返すため、往路だけの数で分ける）
const framesFor = (ctx: FrameContext, result: PathResult, traffic: Traffic): { forward: Frame[]; back: Frame[] } => {
  if (result.path.length < 2) return { forward: [], back: [] };
  const { nat, staticNat, tunnel, fragments, backFragments } = result;
  const base = { ok: true, path: result.path, ...(nat ? { nat } : {}), ...(staticNat ? { staticNat } : {}), ...(tunnel ? { tunnel } : {}), ...(fragments ? { fragments } : {}), ...(backFragments ? { backFragments } : {}) };
  const forward = framesOf(ctx, base, traffic);
  if (!result.back) return { forward, back: [] };
  return { forward, back: framesOf(ctx, { ...base, back: result.back }, traffic).slice(forward.length) };
};

// 区間ごとの最初のフレーム。区間の終わり（次の L3 の機器）に着くフレームまでが、その区間
const segmentFrames = (frames: readonly Frame[], path: readonly string[]): { first: Frame; last: Frame }[] => {
  const out: { first: Frame; last: Frame }[] = [];
  let p = 0;
  for (let i = 0; i + 1 < path.length; i++) {
    const first = frames[p];
    if (!first || first.from !== path[i]) throw new Error(`制御の列: 区間 ${path[i]}→${path[i + 1]} のフレームがない`);
    while (frames[p] && frames[p].to !== path[i + 1]) p++;
    if (!frames[p]) throw new Error(`制御の列: 区間 ${path[i]}→${path[i + 1]} の終わりのフレームがない`);
    out.push({ first, last: frames[p] });
    p++;
  }
  return out;
};

// 変換があれば、変換の直後のフレーム。なければ最初のフレーム
const endToEndFrame = (frames: readonly Frame[]): Frame | undefined => frames.find((f) => f.nat) ?? frames[0];

interface Builder {
  state: NetworkState;
  ctx: FrameContext;
  steps: ControlStep[];
  // ARP を出した区間
  arpDone: Set<string>;
}

// 区間のブロードキャストドメインの L3 の機器（送信元を除く）
const broadcastReach = (b: Builder, from: string, to: string): string[] => {
  const leg = l2Path(from, to, b.ctx.nodes, b.ctx.links, b.ctx.isSwitch);
  if (!leg) throw new Error(`制御の列: 区間がつながらない ${from}→${to}`);
  const link = b.ctx.links.find((l) => (l.a.node === leg[0] && l.b.node === leg[1]) || (l.b.node === leg[0] && l.a.node === leg[1]));
  if (!link) throw new Error(`制御の列: 配線がない ${leg[0]}-${leg[1]}`);
  const port = link.a.node === from ? link.a.port : link.b.port;
  const members = b.state.l2.domainOf({ node: from, port }).members;
  return [...new Set(members.map((m) => m.node))].filter((u) => u !== from && !b.ctx.isSwitch(u));
};

// 区間ごとの ARP の要求・応答。同じ区間は最初の1回だけ
const pushArp = (b: Builder, path: readonly string[], frames: readonly Frame[]): void => {
  const segs = segmentFrames(frames, path);
  for (let i = 0; i + 1 < path.length; i++) {
    const [from, to] = [path[i], path[i + 1]];
    const key = `${from}>${to}`;
    if (b.arpDone.has(key)) continue;
    b.arpDone.add(key);
    const { first, last } = segs[i];
    // 次の機器が受け取る口の IP アドレス
    const link = b.ctx.links.find((l) => l.uid === last.link);
    if (!link) throw new Error(`制御の列: 配線がない ${last.link}`);
    const port = link.a.node === to ? link.a.port : link.b.port;
    const ip = nodeOf(b.state, to).interfaces.find((x) => x.port === port)?.ip;
    if (ip === undefined) throw new Error(`制御の列: IP アドレスが未設定 ${to} の口${port}`);
    b.steps.push({ from, to: '*', reached: broadcastReach(b, from, to), proto: 'arp', label: 'seq.arp.request', params: { ip }, path: [from, to] });
    b.steps.push({ from: to, to: from, reached: [from], proto: 'arp', label: 'seq.arp.reply', params: { ip, mac: first.l2.dstMac }, path: [to, from] });
  }
};

const unicast = (from: string, to: string, proto: ControlStep['proto'], label: string, path: string[], extra: Partial<ControlStep> = {}): ControlStep => ({ from, to, reached: [to], proto, label, path, ...extra });

const failureOf = (result: PathResult): Failure => {
  if (!result.failure) throw new Error('制御の列: 失敗の理由がない');
  return result.failure;
};

const pushPing = (b: Builder, trigger: Extract<ControlTrigger, { kind: 'ping' }>, result: PathResult): void => {
  const { forward, back } = framesFor(b.ctx, result, { kind: 'ping' });
  const path = result.path;
  const segs = segmentFrames(forward, path);
  if (path.length >= 2) pushArp(b, path, forward);
  for (let i = 0; i + 1 < path.length; i++) {
    b.steps.push(unicast(path[i], path[i + 1], 'icmp', 'seq.icmp.request', [path[i], path[i + 1]], { frame: segs[i].first }));
  }
  if (!result.ok) {
    const failure = failureOf(result);
    // 区間の MTU を超えて DF で止まる: その区間の入口の機器が、分割が必要だという ICMP を送信元へ返して止まる
    if (failure.reason === 'mtu.exceeded') b.steps.push(unicast(failure.node, trigger.from, 'icmp', 'seq.icmp.fragNeeded', [...path].reverse(), { failure }));
    else if (failure.reason === 'return.failed') b.steps.push(unicast(trigger.to, trigger.from, 'icmp', 'seq.icmp.reply', [trigger.to], { failure }));
    else b.steps.push({ from: path[path.length - 1], to: trigger.to, reached: [], proto: 'icmp', label: 'seq.icmp.request', path: [path[path.length - 1]], failure });
    return;
  }
  const backPath = result.back;
  if (!backPath) throw new Error('制御の列: 復路がない');
  const backSegs = segmentFrames(back, backPath);
  for (let i = 0; i + 1 < backPath.length; i++) {
    b.steps.push(unicast(backPath[i], backPath[i + 1], 'icmp', 'seq.icmp.reply', [backPath[i], backPath[i + 1]], { frame: backSegs[i].first }));
  }
};

// 名前の問い合わせと応答（再帰の入れ子の順: 問い合わせは呼んだ順、応答は逆順）。引けたかを返す
const pushDns = (b: Builder, from: string, name: string): boolean => {
  const node = nodeOf(b.state, from);
  // 機器自身の対応表にあれば、パケットは出ない
  if ((getComponent(node, 'resolver')?.hosts ?? []).some((h) => h.name === name)) return true;
  const lookup = lookupName(node, name, 'A', b.state.net, b.state.world);
  // 問い合わせの経路は、仮想のインターネットを加えた層から求める（dns.ts が問い合わせた層と同じ）
  const world = analyze(withInternet(b.state.net, b.state.world) ?? b.state.net, b.state.world);
  const inWorld = (uid: string) => world.net.nodes.some((n) => n.uid === uid);
  const pathOf = (s: DnsStep): string[] => {
    // 仮想のインターネットの機器へは、機器の2点だけを流す
    if (!inWorld(s.from) || !inWorld(s.to) || !world.net.links.some((l) => l.a.node === s.to || l.b.node === s.to)) return [s.from, s.to];
    const r = dnsQuery(world, s.from, s.to);
    if (!r.ok) throw new Error(`制御の列: DNS の問い合わせが届かない ${s.from}→${s.to}`);
    return r.path;
  };
  const unreachable = !lookup.ok && lookup.reason === 'dns.unreachable';
  const failure: Failure | undefined = lookup.ok ? undefined : { reason: 'name.unresolved', node: lookup.server ?? from };
  const params = { name };
  lookup.steps.forEach((s, i) => {
    const path = pathOf(s);
    // 仮想のインターネットの機器を含む経路には、ARP を置かない
    if (path.length >= 2 && path.every((u) => b.state.net.nodes.some((n) => n.uid === u))) pushArp(b, path, framesFor(b.ctx, { ok: true, path }, { kind: 'dns' }).forward);
    const last = i === lookup.steps.length - 1;
    b.steps.push(unicast(s.from, s.to, 'dns', 'seq.dns.query', path, { params, ...(last && unreachable && failure ? { failure } : {}) }));
  });
  if (unreachable) return false;
  [...lookup.steps].reverse().forEach((s, i) => {
    const last = i === lookup.steps.length - 1;
    b.steps.push(unicast(s.to, s.from, 'dns', 'seq.dns.response', [...pathOf(s)].reverse(), { params, ...(last && failure ? { failure } : {}) }));
  });
  return lookup.ok;
};

const pushHttp = (b: Builder, trigger: Extract<ControlTrigger, { kind: 'http' }>, result: PathResult): void => {
  const { from, to, port } = trigger;
  const { forward, back } = framesFor(b.ctx, result, { kind: 'http', port });
  if (trigger.name !== undefined && !pushDns(b, from, trigger.name)) return;
  const path = result.path;
  if (path.length >= 2) pushArp(b, path, forward);
  const fwdFrame = endToEndFrame(forward);
  const backFrame = endToEndFrame(back);
  const params = { port };
  const c2s = (proto: ControlStep['proto'], label: string, extra: Partial<ControlStep> = {}): ControlStep => unicast(from, to, proto, label, path, { frame: fwdFrame, params, ...extra });
  const s2c = (proto: ControlStep['proto'], label: string, extra: Partial<ControlStep> = {}): ControlStep => {
    if (!result.back) throw new Error('制御の列: 復路がない');
    return unicast(to, from, proto, label, result.back, { frame: backFrame, params, ...extra });
  };
  if (!result.ok) {
    const failure = failureOf(result);
    if (failure.reason === 'return.failed') {
      b.steps.push(c2s('tcp', 'seq.tcp.syn'), unicast(to, from, 'tcp', 'seq.tcp.synack', [to], { params, failure }));
    } else {
      b.steps.push(c2s('tcp', 'seq.tcp.syn', { failure, reached: path[path.length - 1] === to ? [to] : [] }));
    }
    return;
  }
  b.steps.push(
    c2s('tcp', 'seq.tcp.syn'),
    s2c('tcp', 'seq.tcp.synack'),
    c2s('tcp', 'seq.tcp.ack'),
    c2s('http', 'seq.http.request'),
    s2c('http', 'seq.http.response'),
    c2s('tcp', 'seq.tcp.fin'),
    s2c('tcp', 'seq.tcp.ack'),
    s2c('tcp', 'seq.tcp.fin'),
    c2s('tcp', 'seq.tcp.ack'),
  );
};

// 口と同じブロードキャストドメインの、L3 の機器（自分を除く）
const domainL3 = (b: Builder, uid: string, port: number): string[] => [...new Set(b.state.l2.domainOf({ node: uid, port }).members.map((m) => m.node))].filter((u) => u !== uid && !b.ctx.isSwitch(u));

// 自動の口ごとの Discover・Offer・Request・Ack。サーバーが同じドメインにあれば直接、なければリレー（helper）を持つルーターを通す
const pushDhcp = (b: Builder, trigger: Extract<ControlTrigger, { kind: 'dhcp' }>): void => {
  const client = nodeOf(b.state, trigger.client);
  const ifaces = client.interfaces.filter((i) => i.dhcp === true);
  if (ifaces.length === 0) throw new Error(`制御の列: 自動（DHCP）の口がない ${client.uid}`);
  const { leases, failed } = b.state.addressing.dhcp;
  for (const iface of ifaces) {
    const lease = leases.find((l) => l.uid === client.uid && l.port === iface.port);
    const fail = failed.find((f) => f.uid === client.uid && f.port === iface.port);
    if (lease === undefined && fail === undefined) throw new Error(`制御の列: DHCP の結果がない ${client.uid} の口${iface.port}`);
    const members = b.state.l2.domainOf({ node: client.uid, port: iface.port }).members;
    const broadcast = (label: string, path: string[], reached: string[], extra: Partial<ControlStep> = {}): ControlStep => ({ from: path[0], to: '*', reached, proto: 'dhcp', label, path, ...extra });
    if (lease === undefined) {
      if (fail === undefined) throw new Error('制御の列: DHCP の失敗の理由がない');
      b.steps.push(broadcast('seq.dhcp.discover', [client.uid], domainL3(b, client.uid, iface.port), { failure: { reason: fail.reason, node: client.uid } }));
      continue;
    }
    const params = { ip: lease.ip };
    const server = lease.server;
    if (members.some((m) => m.node === server)) {
      const path = [client.uid, server];
      const reached = domainL3(b, client.uid, iface.port);
      b.steps.push(
        broadcast('seq.dhcp.discover', path, reached),
        unicast(server, client.uid, 'dhcp', 'seq.dhcp.offer', [server, client.uid], { params }),
        broadcast('seq.dhcp.request', path, reached, { params }),
        unicast(server, client.uid, 'dhcp', 'seq.dhcp.ack', [server, client.uid], { params }),
      );
      continue;
    }
    // リレー: クライアントのドメインにいて、リレー先がサーバーのアドレスの口を持つルーター
    const serverIps = nodeOf(b.state, server).interfaces.map((i) => i.ip);
    const found = members
      .map((m) => ({ node: nodeOf(b.state, m.node), helper: nodeOf(b.state, m.node).interfaces.find((i) => i.port === m.port)?.helper }))
      .find((x) => x.helper !== undefined && serverIps.includes(x.helper));
    if (!found || found.helper === undefined) throw new Error(`制御の列: DHCP のリレーのルーターがない ${client.uid}`);
    const relay = found.node;
    // リレーのルーターから、サーバーのアドレスと同じサブネットの口（dhcp.ts の reaches と同じ）を送信元にして、サーバーまでの経路を引く
    const serverIface = { ip: found.helper };
    const toward = relay.interfaces.find((i) => i.ip !== '' && inSubnet(serverIface.ip, i.ip, i.prefix));
    const leg = deliver(b.state, relay.uid, server, { kind: 'ping' }, false, toward?.ip, serverIface.ip);
    if (!leg.ok) throw new Error(`制御の列: リレーからサーバーへ届かない ${relay.uid}→${server}`);
    const toServer = leg.path;
    const toRelay = [...leg.path].reverse();
    const up = (label: string, extra: Partial<ControlStep> = {}): ControlStep => broadcast(label, [client.uid, relay.uid], [relay.uid], extra);
    const down = (label: string): ControlStep => broadcast(label, [relay.uid, client.uid], [client.uid], { params });
    b.steps.push(
      up('seq.dhcp.discover'),
      unicast(relay.uid, server, 'dhcp', 'seq.dhcp.discover', toServer),
      unicast(server, relay.uid, 'dhcp', 'seq.dhcp.offer', toRelay, { params }),
      down('seq.dhcp.offer'),
      up('seq.dhcp.request', { params }),
      unicast(relay.uid, server, 'dhcp', 'seq.dhcp.request', toServer, { params }),
      unicast(server, relay.uid, 'dhcp', 'seq.dhcp.ack', toRelay, { params }),
      down('seq.dhcp.ack'),
    );
  }
};

// OSPF の隣接の確立: Hello（両方向）→ DBD → LSR → LSU → LSAck。隣接にならなければ Hello だけを並べ、最後の行に理由を持つ
const pushOspf = (b: Builder, trigger: Extract<ControlTrigger, { kind: 'ospf' }>): void => {
  const { a, b: peer } = trigger;
  const candidate = b.state.routing.ospfPeersOf(a).find((p) => p.uid === peer);
  if (!candidate) throw new Error(`制御の列: OSPF の隣接の候補でない ${a}→${peer}`);
  const fwd = [a, peer];
  const back = [peer, a];
  const hellos = [unicast(a, peer, 'ospf', 'seq.ospf.hello', fwd), unicast(peer, a, 'ospf', 'seq.ospf.hello', back)];
  if (candidate.mismatch !== null) {
    b.steps.push(...hellos, unicast(peer, a, 'ospf', `seq.ospf.mismatch.${candidate.mismatch}`, back, { failure: { reason: 'ospf.no_neighbor', node: a } }));
    return;
  }
  if (!ospfNeighborsOf(b.state, a).some((n) => n.uid === peer)) throw new Error(`制御の列: 隣接になるはずが隣接にない ${a}→${peer}`);
  b.steps.push(
    ...hellos,
    unicast(a, peer, 'ospf', 'seq.ospf.dbd', fwd),
    unicast(peer, a, 'ospf', 'seq.ospf.dbd', back),
    unicast(a, peer, 'ospf', 'seq.ospf.lsr', fwd),
    unicast(peer, a, 'ospf', 'seq.ospf.lsu', back),
    unicast(a, peer, 'ospf', 'seq.ospf.lsack', fwd),
  );
};

// STP の BPDU: 各リンクの指定ポートの側から相手へ。ルートからの距離の順。相手の口が止まっていれば、その行は止まっている印の文言にする
const pushStp = (b: Builder): void => {
  const { roles, rootCost } = b.state.l2.stp();
  const rows: { from: string; to: string; toPort: number; blocked: boolean; cost: number }[] = [];
  for (const l of b.state.net.links) {
    const ra = roles.get(`${l.a.node}:${l.a.port}`);
    const rb = roles.get(`${l.b.node}:${l.b.port}`);
    if (ra === undefined || rb === undefined) continue;
    const [from, to] = ra === 'designated' ? [l.a, l.b] : [l.b, l.a];
    const cost = rootCost.get(from.node);
    if (cost === undefined) throw new Error(`制御の列: ルートまでのコストがない ${from.node}`);
    rows.push({ from: from.node, to: to.node, toPort: to.port, blocked: roles.get(`${to.node}:${to.port}`) === 'blocking', cost });
  }
  rows.sort((x, y) => x.cost - y.cost || (rootCost.get(x.to) ?? 0) - (rootCost.get(y.to) ?? 0));
  for (const r of rows) {
    b.steps.push(unicast(r.from, r.to, 'stp', r.blocked ? 'seq.stp.bpdu_blocked' : 'seq.stp.bpdu', [r.from, r.to], { params: r.blocked ? { cost: r.cost, port: r.toPort } : { cost: r.cost } }));
  }
};

// VRRP: マスターからバックアップへの Advertisement。続けて、マスターの電源を切った構成の結果から、新しいマスターの Advertisement
const pushVrrp = (b: Builder, trigger: Extract<ControlTrigger, { kind: 'vrrp' }>): void => {
  const { group } = trigger;
  const portOf = (state: NetworkState, uid: string): number => {
    const port = nodeOf(state, uid).interfaces.find((i) => i.vrrp?.some((g) => g.vrid === group))?.port;
    if (port === undefined) throw new Error(`制御の列: VRRP のグループがない ${uid} ${group}`);
    return port;
  };
  const holder = b.state.net.nodes.find((n) => n.interfaces.some((i) => i.vrrp?.some((g) => g.vrid === group)));
  if (!holder) throw new Error(`制御の列: VRRP のグループがない ${group}`);
  const noMaster = (uid: string): ControlStep => ({ from: uid, to: '*', reached: [], proto: 'vrrp', label: 'seq.vrrp.no_master', params: { vrid: group }, path: [uid], failure: { reason: 'vrrp.no_master', node: uid } });
  // マスターの Advertisement を出す。マスターがいなければ null
  const advert = (state: NetworkState, uid: string, label: string): { master: string; members: string[] } | null => {
    const members = state.addressing.vrrpMembers(uid, portOf(state, uid), group);
    const master = electVrrpMaster(members);
    if (master === null) return null;
    const me = members.find((m) => m.uid === master);
    if (!me) throw new Error(`制御の列: マスターが構成員にない ${master}`);
    const others = members.filter((m) => m.up && m.uid !== master).map((m) => m.uid);
    b.steps.push({ from: master, to: '*', reached: others, proto: 'vrrp', label, params: { vrid: group, priority: effectivePriority(me) }, path: [master] });
    return { master, members: members.map((m) => m.uid) };
  };
  const first = advert(b.state, holder.uid, 'seq.vrrp.advertisement');
  if (!first) {
    b.steps.push(noMaster(holder.uid));
    return;
  }
  const survivor = first.members.find((u) => u !== first.master);
  if (survivor === undefined) {
    b.steps.push(noMaster(first.master));
    return;
  }
  // マスターの電源を切った構成で、もう一度求める
  const stopped = analyze({ ...b.state.input, nodes: b.state.input.nodes.map((n) => (n.uid === first.master ? { ...n, powered: false } : n)) }, b.state.world);
  if (!advert(stopped, survivor, 'seq.vrrp.takeover')) b.steps.push(noMaster(survivor));
};

// IPsec VPN のトンネルを張る IKE: フェーズ1（3往復の6行）とフェーズ2（3行）。張れないときは、その理由の行で止める（その行に失敗を持つ）。
// 行の並びは、フェーズ1の1行目から順に。理由ごとの止まる行は、failAt の番号（0 から数える）
const IKE_STEPS: readonly { label: string; from: 'a' | 'b' }[] = [
  { label: 'seq.vpn.p1.1', from: 'a' },
  { label: 'seq.vpn.p1.2', from: 'b' },
  { label: 'seq.vpn.p1.3', from: 'a' },
  { label: 'seq.vpn.p1.4', from: 'b' },
  { label: 'seq.vpn.p1.5', from: 'a' },
  { label: 'seq.vpn.p1.6', from: 'b' },
  { label: 'seq.vpn.p2.1', from: 'a' },
  { label: 'seq.vpn.p2.2', from: 'b' },
  { label: 'seq.vpn.p2.3', from: 'a' },
];
const IKE_FAIL_AT: Record<VpnFailure, number> = {
  'vpn.peer_unreachable': 0,
  'vpn.proposal_mismatch': 1,
  'vpn.psk_mismatch': 5,
  'vpn.selector_mismatch': 7,
};

const pushVpn = (b: Builder, trigger: Extract<ControlTrigger, { kind: 'vpn' }>): void => {
  const { a, b: peer } = trigger;
  const peerIps = nodeOf(b.state, peer).interfaces.map((i) => i.ip);
  // a から peer へのトンネル。張れていれば相手が peer、張れていなければ相手の WAN が peer のアドレスのもの
  const status = b.state.vpn.tunnels.find((s) => s.router === a && (s.ok ? s.peer === peer : peerIps.includes(s.tunnel.peer)));
  const reason: VpnFailure | null = status === undefined ? 'vpn.peer_unreachable' : status.ok ? null : status.reason;
  const failAt = reason === null ? null : IKE_FAIL_AT[reason];
  IKE_STEPS.forEach((step, i) => {
    if (failAt !== null && i > failAt) return;
    const [from, to] = step.from === 'a' ? [a, peer] : [peer, a];
    const failure = reason !== null && i === failAt ? { reason, node: a } : undefined;
    b.steps.push(unicast(from, to, 'ike', step.label, [from, to], failure ? { failure } : {}));
  });
};

export const controlSequence = (state: NetworkState, trigger: ControlTrigger): ControlStep[] => {
  const b: Builder = { state, ctx: frameCtx(state), steps: [], arpDone: new Set() };
  switch (trigger.kind) {
    case 'vpn':
      pushVpn(b, trigger);
      break;
    case 'ping':
      pushPing(b, trigger, ping(state, trigger.from, trigger.to, { size: trigger.size, df: trigger.df }));
      break;
    case 'http':
      pushHttp(b, trigger, http(state, trigger.from, trigger.to, trigger.port));
      break;
    case 'dhcp':
      pushDhcp(b, trigger);
      break;
    case 'ospf':
      pushOspf(b, trigger);
      break;
    case 'stp':
      pushStp(b);
      break;
    case 'vrrp':
      pushVrrp(b, trigger);
      break;
  }
  return b.steps;
};
