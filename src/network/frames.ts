// ホップごとのフレーム。経路（PathResult）を入力にし、通ったリンクごとの MAC・VLAN・IP・TTL・ポートを求める。
// 経路そのものは探さない（ping・http の結果を使う）。L2 スイッチの中の区間は l2Path（mac.ts）で求める。
import { macOf, l2Path } from './mac';
import type { NetLink, NetNode, PathResult, PortConfig } from './types';
import type { Traffic } from './engine/forward';
import { vrrpMac } from './vrrp';

export interface Frame {
  link: string;
  from: string;
  to: string;
  l2: { srcMac: string; dstMac: string; vlan: number | null };
  l3: { srcIp: string; dstIp: string; ttl: number; proto: 'icmp' | 'tcp' };
  l4?: { srcPort: number; dstPort: number };
  // この区間の直前で変換されたとき、変換の前の値（変換したルーターを出た最初のフレームだけに付く）
  nat?: { before: { srcIp: string; srcPort?: number; dstIp: string; dstPort?: number } };
}

export interface FrameContext {
  nodes: readonly NetNode[];
  links: readonly NetLink[];
  categoryOf: (device: string) => string;
  isSwitch: (uid: string) => boolean;
  isRouter: (uid: string) => boolean;
}

// ルーターで変換するアドレス（送信元の NAPT、宛先の静的 NAT）。変換の前後の値を持つ
interface Translation {
  router: string;
  field: 'src' | 'dst';
  before: string;
  after: string;
}

// 送信元の初期の TTL（PC・サーバーは 64）。ルーターが出すパケットは 255
const INITIAL_TTL = 64;
// HTTP の一時ポートの範囲（49152 以上）。乱数を使わず、送信元と宛先の組から決める
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

const l2LegOf = (ctx: FrameContext, a: string, b: string): string[] => {
  const p = l2Path(a, b, ctx.nodes, ctx.links, ctx.isSwitch);
  if (p === null) throw new Error(`フレームの計算: 経路がつながらない ${a}→${b}`);
  return p;
};

// 次のホップが、仮想の IP アドレス（VRRP）を宛先のゲートウェイ・次のホップにして届けるルーターなら、その仮想 MAC（NET.md §5.12）。
// 送る側のゲートウェイか静的経路の次のホップが、受け取るルーターの VRRP のグループの仮想 IP アドレスと同じときに限る
const virtualMacTo = (from: NetNode, to: NetNode): string | null => {
  const nextHops = [from.gateway, ...from.routes.map((r) => r.nextHop)];
  const group = to.interfaces.flatMap((i) => i.vrrp ?? []).find((g) => nextHops.includes(g.ip));
  return group ? vrrpMac(group.vrid) : null;
};

// 経路の両端の IP アドレス（始めの機器の送り出す口と、終わりの機器の受け取る口）
const endToEndIps = (ctx: FrameContext, path: readonly string[]): { srcIp: string; dstIp: string } => {
  const first = nodeOf(ctx, path[0]);
  const last = nodeOf(ctx, path[path.length - 1]);
  const firstNodes = l2LegOf(ctx, path[0], path[1]);
  const lastNodes = l2LegOf(ctx, path[path.length - 2], path[path.length - 1]);
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

// 1本の経路（往路または復路）のフレーム。変換があれば、変換した機器より前と後で値を切り替える
const legFrames = (ctx: FrameContext, path: string[], traffic: Traffic, tr: Translation | undefined, reversed: boolean): Frame[] => {
  const frames: Frame[] = [];
  const e2e = endToEndIps(ctx, path);
  const first = path[0];
  const last = path[path.length - 1];
  const natIdx = tr ? path.indexOf(tr.router) : -1;
  if (tr && natIdx < 0) throw new Error(`フレームの計算: 変換の機器が経路にない ${tr.router}`);
  const proto = traffic.kind === 'http' ? 'tcp' : 'icmp';
  // 区間 i の送信元・宛先のアドレス。変換の機器より前の区間は before、変換の機器を出る区間から後は after
  const addrAt = (i: number): { srcIp: string; dstIp: string } => {
    const pick = (field: 'src' | 'dst'): string => (tr && tr.field === field ? (i < natIdx ? tr.before : tr.after) : field === 'src' ? e2e.srcIp : e2e.dstIp);
    return { srcIp: pick('src'), dstIp: pick('dst') };
  };
  // 区間 i の、HTTP のときのポート。往路の送信元の一時ポートは、NAPT の変換の後で変わる
  const portsAt = (i: number): { srcPort: number; dstPort: number } | undefined => {
    if (traffic.kind !== 'http') return undefined;
    if (reversed) return { srcPort: traffic.port, dstPort: ephemeralPort(`${last}|${first}`) };
    const translated = tr?.field === 'src' && i >= natIdx;
    return { srcPort: ephemeralPort(translated ? `${tr!.router}|${last}` : `${first}|${last}`), dstPort: traffic.port };
  };

  let ttl = INITIAL_TTL;
  for (let i = 0; i + 1 < path.length; i++) {
    const from = nodeOf(ctx, path[i]);
    const to = nodeOf(ctx, path[i + 1]);
    // 区間の始まりの機器がルーターなら、そこから TTL の初期値を変える（ルーターが出すパケット）
    if (i === 0 && ctx.isRouter(from.uid)) ttl = 255;
    // 途中のルーターを越えるたびに 1 減る
    if (i > 0 && ctx.isRouter(from.uid)) ttl -= 1;

    // 区間（L3 の1ホップ）の中の物理の経路。L2 スイッチを通るときは、スイッチの間のリンクごとにフレームを出す
    const nodes = l2LegOf(ctx, from.uid, to.uid);
    const firstLink = linkBetween(ctx, nodes[0], nodes[1]);
    const lastLink = linkBetween(ctx, nodes[nodes.length - 2], nodes[nodes.length - 1]);
    // 区間の MAC は、送り出す L3 の機器の口と、受け取る L3 の機器の口（ルーターを越えるたびに付け替わる）
    const srcMac = macOn(ctx, from, portOn(firstLink, from.uid));
    // 最後の機器でないルーターへ、仮想の IP アドレスのゲートウェイで送るときは、宛先の MAC は仮想 MAC
    const dstMac = ctx.isRouter(to.uid) && i + 2 < path.length ? (virtualMacTo(from, to) ?? macOn(ctx, to, portOn(lastLink, to.uid))) : macOn(ctx, to, portOn(lastLink, to.uid));
    const vlan = carriedVlanOf(ctx, firstLink, from.uid);
    const addr = addrAt(i);
    const l4 = portsAt(i);
    for (let k = 0; k + 1 < nodes.length; k++) {
      const link = linkBetween(ctx, nodes[k], nodes[k + 1]);
      const frame: Frame = {
        link: link.uid,
        from: nodes[k],
        to: nodes[k + 1],
        l2: { srcMac, dstMac, vlan: tagOn(ctx, link, vlan) },
        l3: { srcIp: addr.srcIp, dstIp: addr.dstIp, ttl, proto },
      };
      if (l4) frame.l4 = l4;
      // 変換の機器を出た最初のフレームに、変換の前の値を付ける
      if (tr && i === natIdx && k === 0) {
        const before = addrAt(i - 1);
        const beforeL4 = portsAt(i - 1);
        frame.nat = { before: { srcIp: before.srcIp, dstIp: before.dstIp, ...(beforeL4 ? { srcPort: beforeL4.srcPort, dstPort: beforeL4.dstPort } : {}) } };
      }
      frames.push(frame);
    }
  }
  return frames;
};

// 往路と復路のフレーム。NAPT は往路の送信元と復路の宛先を、静的 NAT は往路の宛先を変換する
export const framesOf = (ctx: FrameContext, result: PathResult, traffic: Traffic = { kind: 'ping' }): Frame[] => {
  if (!result.ok || result.path.length < 2) return [];
  const forwardTr: Translation | undefined = result.nat
    ? { router: result.nat.router, field: 'src', before: result.nat.insideIp, after: result.nat.outsideIp }
    : result.staticNat
      ? { router: result.staticNat.router, field: 'dst', before: result.staticNat.outsideIp, after: result.staticNat.insideIp }
      : undefined;
  const frames = legFrames(ctx, result.path, traffic, forwardTr, false);
  if (result.back && result.back.length >= 2) {
    const backTr: Translation | undefined = result.nat ? { router: result.nat.router, field: 'dst', before: result.nat.outsideIp, after: result.nat.insideIp } : undefined;
    frames.push(...legFrames(ctx, result.back, traffic, backTr, true));
  }
  return frames;
};
