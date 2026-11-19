// 制御のパケットの列（シーケンス図の元）。ping・http の結果（経路）と framesOf（frames.ts）、DNS の名前の解決（dns.ts）の結果を並べるだけで、通信は計算し直さない。
// ARP の表は持たず、区間ごとに最初の通信の前に「初回」として出す。乱数は使わない。
import { deviceCategory } from '../registry/query';
import { can } from './capabilities';
import { isL2Category, isRoutingCategory } from './category';
import { getComponent } from './components';
import { lookupName, type DnsStep } from './dns';
import { analyze } from './engine/analyze';
import { dnsQuery, http, ping } from './engine/forward';
import type { Traffic } from './engine/forward';
import type { NetworkState } from './engine/state';
import { withInternet } from './external';
import { framesOf, type Frame, type FrameContext } from './frames';
import { l2Path } from './mac';
import type { Failure, NetNode, PathResult } from './types';

export type ControlTrigger = { kind: 'ping'; from: string; to: string } | { kind: 'http'; from: string; to: string; port: number; name?: string };

export interface ControlStep {
  from: string;
  // ブロードキャストのときは '*'
  to: string;
  // 届いた L3 の機器の uid（ユニキャストなら [to]）
  reached: string[];
  proto: 'arp' | 'icmp' | 'udp' | 'tcp' | 'dns' | 'http';
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
  const { nat, staticNat } = result;
  const base = { ok: true, path: result.path, ...(nat ? { nat } : {}), ...(staticNat ? { staticNat } : {}) };
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
    if (failure.reason === 'return.failed') b.steps.push(unicast(trigger.to, trigger.from, 'icmp', 'seq.icmp.reply', [trigger.to], { failure }));
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

export const controlSequence = (state: NetworkState, trigger: ControlTrigger): ControlStep[] => {
  const b: Builder = { state, ctx: frameCtx(state), steps: [], arpDone: new Set() };
  switch (trigger.kind) {
    case 'ping':
      pushPing(b, trigger, ping(state, trigger.from, trigger.to));
      break;
    case 'http':
      pushHttp(b, trigger, http(state, trigger.from, trigger.to, trigger.port));
      break;
  }
  return b.steps;
};
