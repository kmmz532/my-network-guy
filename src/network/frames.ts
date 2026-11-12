// ホップごとのフレーム（付録 B.2）。経路（PathResult.path）を入力にし、通ったリンクごとの MAC・VLAN・IP・TTL・ポートを求める。
// 経路そのものは探さない（ping・http の結果を使う）。L2 スイッチの中の区間は l2Path（mac.ts）で求める。
// 未了: 静的 NAT の変換前の値（PathResult に静的 NAT の記録がないため）・戻りの経路のフレーム。
import { macOf, l2Path } from './mac';
import type { NetLink, NetNode, PathResult, PortConfig } from './types';
import type { Traffic } from './netState';

export interface Frame {
  link: string;
  from: string;
  to: string;
  l2: { srcMac: string; dstMac: string; vlan: number | null };
  l3: { srcIp: string; dstIp: string; ttl: number; proto: 'icmp' | 'tcp' };
  l4?: { srcPort: number; dstPort: number };
  // この区間の直前で NAPT の変換があったとき、変換の前の値（変換したルーターを出た最初のフレームだけに付く）
  nat?: { before: { srcIp: string; srcPort?: number; dstIp: string; dstPort?: number } };
}

export interface FrameContext {
  nodes: readonly NetNode[];
  links: readonly NetLink[];
  categoryOf: (device: string) => string;
  isSwitch: (uid: string) => boolean;
  isRouter: (uid: string) => boolean;
}

// 送信元の初期の TTL（PC・サーバーは 64）。ルーターが出すパケットは 255（付録 B.2）
const INITIAL_TTL = 64;
// HTTP の送信元の一時ポートの範囲（49152 以上）。乱数を使わず、送信元と宛先の組から決める
const EPHEMERAL_BASE = 49152;
const EPHEMERAL_SPAN = 16384;

const nodeOf = (ctx: FrameContext, uid: string): NetNode => {
  const n = ctx.nodes.find((x) => x.uid === uid);
  if (!n) throw new Error(`フレームの計算: 機器がない ${uid}`);
  return n;
};

const linkBetween = (ctx: FrameContext, a: string, b: string): NetLink => {
  const l = ctx.links.find((x) => (x.a.node === a && x.b.node === b) || (x.a.node === b && x.b.node === a));
  if (!l) throw new Error(`フレームの計算: 配線がない ${a}-${b}`);
  return l;
};

// 配線の、その機器側の口の番号
const portOn = (link: NetLink, uid: string): number => (link.a.node === uid ? link.a.port : link.b.port);

// 機器の口の設定（設定のない口は undefined）
const cfgOf = (node: NetNode, port: number): PortConfig | undefined => node.ports.find((p) => p.port === port);

const ipOn = (node: NetNode, port: number): string => {
  const iface = node.interfaces.find((i) => i.port === port);
  if (!iface) throw new Error(`フレームの計算: IP アドレスが未設定 ${node.uid} の口${port}`);
  return iface.ip;
};

const macOn = (ctx: FrameContext, node: NetNode, port: number): string => {
  if (node.macSerial === undefined) throw new Error(`フレームの計算: MAC の連番がない ${node.uid}`);
  return macOf(ctx.categoryOf(node.device), node.macSerial, port);
};

// 送信元と宛先の組から、一時ポートを決める（同じ構成・同じ通信なら同じ値）
const ephemeralPort = (key: string): number => {
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return EPHEMERAL_BASE + (h % EPHEMERAL_SPAN);
};

// 経路の両端の IP アドレス（送信元は最初の機器の送り出す口、宛先は最後の機器の受け取る口）
const endToEndIps = (ctx: FrameContext, path: readonly string[]): { srcIp: string; dstIp: string } => {
  const first = nodeOf(ctx, path[0]);
  const last = nodeOf(ctx, path[path.length - 1]);
  const legOf = (a: string, b: string): string[] => {
    const p = l2Path(a, b, ctx.nodes, ctx.links, ctx.isSwitch);
    if (p === null) throw new Error(`フレームの計算: 経路がつながらない ${a}→${b}`);
    return p;
  };
  const firstNodes = legOf(path[0], path[1]);
  const lastNodes = legOf(path[path.length - 2], path[path.length - 1]);
  const firstLink = linkBetween(ctx, firstNodes[0], firstNodes[1]);
  const lastLink = linkBetween(ctx, lastNodes[lastNodes.length - 2], lastNodes[lastNodes.length - 1]);
  return { srcIp: ipOn(first, portOn(firstLink, first.uid)), dstIp: ipOn(last, portOn(lastLink, last.uid)) };
};

// 区間の VLAN。送信元につながるスイッチの access の口の VLAN（端末の口には設定がない。既定は VLAN 1）
const carriedVlanOf = (ctx: FrameContext, firstLink: NetLink, senderUid: string): number => {
  const other = firstLink.a.node === senderUid ? firstLink.b : firstLink.a;
  const cfg = cfgOf(nodeOf(ctx, other.node), other.port);
  return cfg?.mode === 'access' ? (cfg.vlan ?? 1) : 1;
};

// そのリンクを VLAN のタグつきで通るか。トランクの口を通り、その VLAN が native VLAN でなければタグを付ける（802.1Q）
const tagOn = (ctx: FrameContext, link: NetLink, vlan: number): number | null => {
  for (const ep of [link.a, link.b]) {
    const cfg = cfgOf(nodeOf(ctx, ep.node), ep.port);
    if (cfg?.mode === 'trunk') return vlan === (cfg.native ?? 1) ? null : vlan;
  }
  return null;
};

export const framesOf = (ctx: FrameContext, result: PathResult, traffic: Traffic = { kind: 'ping' }): Frame[] => {
  if (!result.ok || result.path.length < 2) return [];
  const frames: Frame[] = [];
  const dst = result.path[result.path.length - 1];
  const src = result.path[0];
  const e2e = endToEndIps(ctx, result.path);
  const proto = traffic.kind === 'http' ? 'tcp' : 'icmp';
  // HTTP のときだけ L4 のポートを持つ。送信元の一時ポートは、NAPT の変換の前後で変わる
  const l4Of = (srcPort: number): { srcPort: number; dstPort: number } | undefined =>
    traffic.kind === 'http' ? { srcPort, dstPort: traffic.port } : undefined;
  const natIdx = result.nat ? result.path.indexOf(result.nat.router) : -1;
  let ttl = INITIAL_TTL;
  for (let i = 0; i + 1 < result.path.length; i++) {
    const from = nodeOf(ctx, result.path[i]);
    const to = nodeOf(ctx, result.path[i + 1]);
    // 区間の始まりの機器がルーターなら、そこから TTL の初期値を変える（ルーターが出すパケット）
    if (i === 0 && ctx.isRouter(from.uid)) ttl = 255;
    // 途中のルーターを越えるたびに 1 減る
    if (i > 0 && ctx.isRouter(from.uid)) ttl -= 1;

    // NAPT の後の区間は、送信元が外のアドレスと一時ポートに変わる
    const translated = natIdx >= 0 && i >= natIdx;
    const srcIp = translated && result.nat ? result.nat.outsideIp : e2e.srcIp;
    const srcPort = traffic.kind === 'http' ? ephemeralPort(translated ? `${result.nat?.router}|${dst}` : `${src}|${dst}`) : 0;

    // 区間（L3 の1ホップ）の中の物理の経路。L2 スイッチを通るときは、スイッチの間のリンクごとにフレームを出す
    const nodes = l2Path(from.uid, to.uid, ctx.nodes, ctx.links, ctx.isSwitch);
    if (nodes === null) throw new Error(`フレームの計算: 経路がつながらない ${from.uid}→${to.uid}`);
    const firstLink = linkBetween(ctx, nodes[0], nodes[1]);
    const lastLink = linkBetween(ctx, nodes[nodes.length - 2], nodes[nodes.length - 1]);
    // 区間の MAC は、送り出す L3 の機器の口と、受け取る L3 の機器の口（ルーターを越えるたびに付け替わる）
    const srcMac = macOn(ctx, from, portOn(firstLink, from.uid));
    const dstMac = macOn(ctx, to, portOn(lastLink, to.uid));
    const vlan = carriedVlanOf(ctx, firstLink, from.uid);
    for (let k = 0; k + 1 < nodes.length; k++) {
      const link = linkBetween(ctx, nodes[k], nodes[k + 1]);
      const frame: Frame = {
        link: link.uid,
        from: nodes[k],
        to: nodes[k + 1],
        l2: { srcMac, dstMac, vlan: tagOn(ctx, link, vlan) },
        l3: { srcIp, dstIp: e2e.dstIp, ttl, proto },
      };
      const l4 = l4Of(srcPort);
      if (l4) frame.l4 = l4;
      // 変換したルーターを出た最初のフレームに、変換の前の値を付ける
      if (natIdx >= 0 && i === natIdx && k === 0 && result.nat) {
        frame.nat = { before: { srcIp: result.nat.insideIp, dstIp: e2e.dstIp, ...(l4 ? { srcPort: ephemeralPort(`${src}|${dst}`), dstPort: l4.dstPort } : {}) } };
      }
      frames.push(frame);
    }
  }
  return frames;
};
