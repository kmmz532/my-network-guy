// リンクアグリゲーションの計算（純粋関数。NET.md §5.1）。同じ2台の間の複数のリンクを、1本の論理リンク（ポートチャネル）にまとめる。
// - まとまる条件: 両端の口が同じチャネルの番号を持ち、モードが組み合わさり（active／active・active／passive・on／on）、
//   口のモード・VLAN・native・allowed が一致する
// - 条件を満たさない口は個別の口として残り、不一致（mismatch）に数える
// - 速さ（両端の口の遅いほう）が、まとめる配線の間で一致する。速さが定義にない機器は扱わない
import type { NetLink, NetNode, PortConfig } from './types';

export type LacpMode = 'active' | 'passive' | 'on';

export interface LagBundle {
  // 2台の機器の uid（並びは配線の a・b の最初に現れた順）
  a: string;
  b: string;
  // チャネルの番号
  channel: number;
  // まとまった物理のリンク。番号の最も小さい物理のリンク（a 側の口の番号が最小）が先頭
  links: NetLink[];
}

export interface LagResult {
  bundles: LagBundle[];
  // まとまらなかった配線（チャネルの設定のある口のうち、条件を満たさないもの）。配線の uid
  mismatched: Set<string>;
  // まとまった配線の uid → 論理リンクの代表（番号の最も小さい口のリンク）の uid
  representative: Map<string, string>;
}

// 両端のモードの組み合わせでまとまるか。on は LACP を使わない固定のまとめ。on と LACP（active・passive）はまとまらない
export const lacpCompatible = (x: LacpMode | undefined, y: LacpMode | undefined): boolean => {
  if (x === undefined || y === undefined) return false;
  if (x === 'on' || y === 'on') return x === 'on' && y === 'on';
  return x === 'active' || y === 'active';
};

// 口の VLAN の設定（まとまる両端・まとまる口どうしで一致する必要がある）を、比べられる文字列にする
const shape = (cfg: PortConfig | undefined): string => {
  const mode = cfg?.mode ?? 'access';
  if (mode === 'trunk') return `trunk:${cfg?.native ?? 1}:${cfg?.allowed === undefined ? '*' : [...cfg.allowed].sort((p, q) => p - q).join(',')}`;
  return `${mode}:${cfg?.vlan ?? 1}`;
};

// 配線の速さ（両端の口の速さの遅いほう。速さを扱わないときは undefined）
export const computeLags = (
  nodes: readonly NetNode[],
  links: readonly NetLink[],
  isLagCapable: (node: NetNode) => boolean,
  speedOf: (node: NetNode, port: number) => number | undefined = () => undefined,
): LagResult => {
  const linkSpeed = (l: NetLink): number | undefined => {
    const a = speedOf(byUid.get(l.a.node)!, l.a.port);
    const b = speedOf(byUid.get(l.b.node)!, l.b.port);
    return a === undefined || b === undefined ? undefined : Math.min(a, b);
  };
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const cfgOf = (uid: string, port: number) => byUid.get(uid)?.ports.find((p) => p.port === port);
  const result: LagResult = { bundles: [], mismatched: new Set(), representative: new Map() };

  // チャネルの設定のある口を持つ配線を、2台の組とチャネルの番号ごとに集める
  const groups = new Map<string, { a: string; b: string; channel: number; links: NetLink[] }>();
  for (const l of links) {
    const na = byUid.get(l.a.node);
    const nb = byUid.get(l.b.node);
    if (!na || !nb || na.uid === nb.uid || !isLagCapable(na) || !isLagCapable(nb)) continue;
    const ca = cfgOf(l.a.node, l.a.port);
    const cb = cfgOf(l.b.node, l.b.port);
    if (ca?.channelGroup === undefined && cb?.channelGroup === undefined) continue;
    // 片方にしか設定がない、または番号が違う口は、まとまらない
    if (ca?.channelGroup === undefined || cb?.channelGroup === undefined || ca.channelGroup !== cb.channelGroup) {
      result.mismatched.add(l.uid);
      continue;
    }
    const pair = [l.a.node, l.b.node].sort().join('|');
    const k = `${pair}#${ca.channelGroup}`;
    const g = groups.get(k) ?? groups.set(k, { a: [l.a.node, l.b.node].sort()[0], b: [l.a.node, l.b.node].sort()[1], channel: ca.channelGroup, links: [] }).get(k)!;
    g.links.push(l);
  }

  for (const g of groups.values()) {
    // 端の口の番号（a 側の機器の口）の昇順。先頭の口の設定を基準にして、同じ設定の口だけをまとめる
    const endOf = (l: NetLink, uid: string) => (l.a.node === uid ? l.a : l.b);
    const ordered = [...g.links].sort((x, y) => endOf(x, g.a).port - endOf(y, g.a).port);
    const usable = ordered.filter((l) => {
      const ca = cfgOf(g.a, endOf(l, g.a).port)!;
      const cb = cfgOf(g.b, endOf(l, g.b).port)!;
      return lacpCompatible(ca.lacp, cb.lacp) && shape(ca) === shape(cb);
    });
    for (const l of ordered) if (!usable.includes(l)) result.mismatched.add(l.uid);
    if (usable.length === 0) continue;
    const reference = shape(cfgOf(g.a, endOf(usable[0], g.a).port));
    const members: NetLink[] = [];
    for (const l of usable) {
      if (shape(cfgOf(g.a, endOf(l, g.a).port)) === reference && linkSpeed(l) === linkSpeed(usable[0])) members.push(l);
      else result.mismatched.add(l.uid);
    }
    result.bundles.push({ a: g.a, b: g.b, channel: g.channel, links: members });
    for (const l of members) result.representative.set(l.uid, members[0].uid);
  }
  return result;
};
