import { makeIface } from '../network/iface';
// 色（サブネット）でIPアドレス・ゲートウェイ・ルートを決めていた第2版の規則。古いセーブの移行（v4→v5、v12→v13）でだけ使う。
// 通常の判定・表示には使わない（それらは network/compile.ts と network/segments.ts を使う）。
import { ipToInt } from '../network/engine';
import { epKey, segmentsOf } from '../network/segments';
import type { EngineData, Iface, NetLink, NetNode, Route } from '../network/types';
import { CATEGORY } from '../data/categories';

// 色を持つ古い機器の形式（色は v12 までの機器が持っていた）
type LNode = NetNode & { colors?: Record<number, number> };

const networkOf = (ip: string): number => (ipToInt(ip) & 0xffffff00) >>> 0;
const intToIp = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');

// 固定設定のIPアドレスから色を決める。同じサブネットには同じ色を割り当てる（v4 → v5 の移行）
export const colorsFromConfig = (nodes: LNode[]): LNode[] => {
  const colorOfNet = new Map<number, number>();
  return nodes.map((n) => {
    if (!n.interfaces.length) return n;
    const colors: Record<number, number> = { ...(n.colors ?? {}) };
    for (const i of n.interfaces) {
      const net = networkOf(i.ip);
      if (!colorOfNet.has(net)) colorOfNet.set(net, colorOfNet.size + 1);
      colors[i.port] = colorOfNet.get(net)!;
    }
    return { ...n, colors };
  });
};

// 色の設定から、IPアドレス・デフォルトゲートウェイ・ルートを作る（v12 → v13 の移行）。
// 色を持つ機器だけを対象にし、色を持たない機器は色の時代の判定と同じく IPアドレスを持たない
export const legacyInterfaces = (nodes: LNode[], links: NetLink[], data: EngineData): LNode[] => {
  const segs = segmentsOf({ nodes, links }, data);
  const domainOf = new Map<string, string>();
  for (const s of segs) for (const m of s.members) domainOf.set(epKey(m.node, m.port), s.key);
  const dom = (node: string, port: number) => domainOf.get(epKey(node, port)) ?? epKey(node, port);
  const cat = (n: LNode) => data.categoryOf(n.device);
  const colorsOf = (n: LNode): Record<number, number> => n.colors ?? {};
  const coloredPorts = (n: LNode): number[] => {
    const c = cat(n);
    if (c === CATEGORY.l2Switch) return [];
    if (c === CATEGORY.router) return Object.keys(colorsOf(n)).map(Number);
    return colorsOf(n)[0] ? [0] : [];
  };
  const fixed = (n: LNode) => n.configLocked && n.interfaces.length > 0;

  // 色ごとのサブネット。固定設定のある色はそのサブネットを使う
  const subnet = new Map<number, number>();
  for (const n of nodes) {
    if (!fixed(n)) continue;
    for (const i of n.interfaces) {
      const c = colorsOf(n)[i.port];
      if (c && !subnet.has(c)) subnet.set(c, networkOf(i.ip));
    }
  }
  const subnetOf = (c: number) => subnet.get(c) ?? ipToInt(`192.168.${100 + c}.0`);

  const used = new Set<number>();
  for (const n of nodes) if (fixed(n)) for (const i of n.interfaces) used.add(ipToInt(i.ip));
  const alloc = (c: number, start: number): string => {
    const base = subnetOf(c);
    for (let h = start; h < 255; h++) {
      if (!used.has(base + h)) {
        used.add(base + h);
        return intToIp(base + h);
      }
    }
    return intToIp(base + 254);
  };

  const sorted = [...nodes].sort((a, b) => (a.uid < b.uid ? -1 : 1));
  const ifaces = new Map<string, Iface[]>();
  // ルーターのポートは .1 から、PC・サーバーは .11 から割り当てる
  for (const n of sorted) {
    if (fixed(n)) {
      ifaces.set(n.uid, n.interfaces.map((i) => ({ ...i })));
      continue;
    }
    const list: Iface[] = [];
    for (const port of coloredPorts(n).sort((a, b) => a - b)) {
      const c = colorsOf(n)[port];
      list.push(makeIface(n.device, port, alloc(c, cat(n) === CATEGORY.router ? 1 : 11), 24));
    }
    ifaces.set(n.uid, list);
  }

  const routerPorts: { node: LNode; color: number; domain: string; ip: string }[] = [];
  for (const n of nodes) {
    if (cat(n) !== CATEGORY.router) continue;
    for (const i of ifaces.get(n.uid)!) {
      routerPorts.push({ node: n, color: colorsOf(n)[i.port], domain: dom(n.uid, i.port), ip: i.ip });
    }
  }

  // ルーター同士が同じ色でつながっていれば隣接とし、幅優先探索で次のホップを決める
  const routes = new Map<string, Route[]>();
  for (const r of nodes.filter((n) => cat(n) === CATEGORY.router)) {
    const direct = new Set(routerPorts.filter((p) => p.node.uid === r.uid).map((p) => p.color));
    const result: Route[] = [];
    const seenColors = new Set(direct);
    const visited = new Set([r.uid]);
    let frontier: [string, string | null][] = [[r.uid, null]];
    while (frontier.length) {
      const next: [string, string | null][] = [];
      for (const [uid, firstHop] of frontier) {
        for (const mine of routerPorts.filter((p) => p.node.uid === uid)) {
          for (const peer of routerPorts) {
            if (visited.has(peer.node.uid) || peer.domain !== mine.domain || peer.color !== mine.color) continue;
            visited.add(peer.node.uid);
            const hop = firstHop ?? peer.ip;
            for (const far of routerPorts.filter((p) => p.node.uid === peer.node.uid)) {
              if (seenColors.has(far.color)) continue;
              seenColors.add(far.color);
              result.push({ dest: intToIp(subnetOf(far.color)), prefix: 24, nextHop: hop });
            }
            next.push([peer.node.uid, hop]);
          }
        }
      }
      frontier = next;
    }
    routes.set(r.uid, result);
  }

  return nodes.map((n) => {
    const c = cat(n);
    if (c === CATEGORY.l2Switch) return { ...n, interfaces: [], gateway: null, routes: [] };
    if (c === CATEGORY.router) return { ...n, interfaces: ifaces.get(n.uid)!, gateway: null, routes: routes.get(n.uid)! };
    const color = colorsOf(n)[0];
    let gateway = fixed(n) ? n.gateway : null;
    if (color && !fixed(n)) {
      const d = dom(n.uid, 0);
      const gw = routerPorts
        .filter((p) => p.domain === d && p.color === color)
        .sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip))[0];
      gateway = gw?.ip ?? null;
    }
    return { ...n, interfaces: ifaces.get(n.uid)!, gateway, routes: [] };
  });
};
