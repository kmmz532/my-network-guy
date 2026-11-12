// ホップごとのフレーム。経路（PathResult.path）を入力にし、通ったリンクごとの MAC・IP・TTL を求める
// 経路そのものは探さない（ping・http の結果を使う）。L2 スイッチの中の区間は l2Path（mac.ts）で求める
// 未了: VLAN タグ（トランク）・NAT の変換前の値・L4 のポート番号は、後の段で加える
import { macOf, l2Path } from './mac';
import type { NetLink, NetNode, PathResult } from './types';

export type Proto = 'icmp' | 'tcp';

export interface Frame {
  link: string;
  from: string;
  to: string;
  l2: { srcMac: string; dstMac: string; vlan: null };
  l3: { srcIp: string; dstIp: string; ttl: number; proto: Proto };
}

export interface FrameContext {
  nodes: readonly NetNode[];
  links: readonly NetLink[];
  categoryOf: (device: string) => string;
  isSwitch: (uid: string) => boolean;
  isRouter: (uid: string) => boolean;
}

// 送信元の初期の TTL（PC・サーバーは 64）。ルーターが出すパケットは 255
const INITIAL_TTL = 64;

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

const ipOn = (node: NetNode, port: number): string => {
  const iface = node.interfaces.find((i) => i.port === port);
  if (!iface) throw new Error(`フレームの計算: IP アドレスが未設定 ${node.uid} の口${port}`);
  return iface.ip;
};

const macOn = (ctx: FrameContext, node: NetNode, port: number): string => {
  if (node.macSerial === undefined) throw new Error(`フレームの計算: MAC の連番がない ${node.uid}`);
  return macOf(ctx.categoryOf(node.device), node.macSerial, port);
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

export const framesOf = (ctx: FrameContext, result: PathResult, proto: Proto = 'icmp'): Frame[] => {
  if (!result.ok || result.path.length < 2) return [];
  const frames: Frame[] = [];
  // IP アドレスは区間をまたいでも変わらない（NAT の変換は後の段で扱う）。送信元・宛先の機器の口のアドレス
  const e2e = endToEndIps(ctx, result.path);
  let ttl = INITIAL_TTL;
  for (let i = 0; i + 1 < result.path.length; i++) {
    const from = nodeOf(ctx, result.path[i]);
    const to = nodeOf(ctx, result.path[i + 1]);
    // 区間の始まりの機器がルーターなら、そこから TTL の初期値を変える（ルーターが出すパケット）
    if (i === 0 && ctx.isRouter(from.uid)) ttl = 255;
    // 途中のルーターを越えるたびに 1 減る
    if (i > 0 && ctx.isRouter(from.uid)) ttl -= 1;

    // 区間（L3 の1ホップ）の中の物理の経路。L2 スイッチを通るときは、スイッチの間のリンクごとにフレームを出す
    const nodes = l2Path(from.uid, to.uid, ctx.nodes, ctx.links, ctx.isSwitch);
    if (nodes === null) throw new Error(`フレームの計算: 経路がつながらない ${from.uid}→${to.uid}`);
    const firstLink = linkBetween(ctx, nodes[0], nodes[1]);
    const lastLink = linkBetween(ctx, nodes[nodes.length - 2], nodes[nodes.length - 1]);
    // 区間の MAC は、送り出す L3 の機器の口と、受け取る L3 の機器の口（ルーターを越えるたびに付け替わる）
    const srcMac = macOn(ctx, from, portOn(firstLink, from.uid));
    const dstMac = macOn(ctx, to, portOn(lastLink, to.uid));
    for (let k = 0; k + 1 < nodes.length; k++) {
      const link = linkBetween(ctx, nodes[k], nodes[k + 1]);
      frames.push({ link: link.uid, from: nodes[k], to: nodes[k + 1], l2: { srcMac, dstMac, vlan: null }, l3: { srcIp: e2e.srcIp, dstIp: e2e.dstIp, ttl, proto } });
    }
  }
  return frames;
};
