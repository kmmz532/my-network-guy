// 色（サブネット）の設定から、IPアドレス・デフォルトゲートウェイ・ルートを生成する。
// 判定エンジンは生成した設定をそのまま使う。仕様は memo/sim-2.md を参照する。
import { ipToInt } from './engine';
import type { EngineData, Iface, NetNode, Network, Route } from './types';

export const COLOR_COUNT = 6;

export type Issue = 'unset' | 'mixed' | 'no_gateway';

const intToIp = (n: number): string => [24, 16, 8, 0].map((s) => (n >>> s) & 255).join('.');
const networkOf = (ip: string): number => (ipToInt(ip) & 0xffffff00) >>> 0;
const epKey = (node: string, port: number) => `${node}:${port}`;

// 端点をL2ドメインごとにまとめる（配線とスイッチでつながった端点を同じ組にする）
const domains = (net: Network, data: EngineData): Map<string, string> => {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    parent.set(k, r);
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const link of net.links) union(epKey(link.a.node, link.a.port), epKey(link.b.node, link.b.port));
  const isSwitch = (uid: string) => {
    const n = net.nodes.find((x) => x.uid === uid);
    return !!n && data.categoryOf(n.device) === 'l2_switch';
  };
  // スイッチのポートはすべて同じドメインにする
  const switchRoot = new Map<string, string>();
  for (const link of net.links) {
    for (const ep of [link.a, link.b]) {
      if (!isSwitch(ep.node)) continue;
      const k = epKey(ep.node, ep.port);
      const first = switchRoot.get(ep.node);
      if (first) union(k, first);
      else switchRoot.set(ep.node, k);
    }
  }
  const result = new Map<string, string>();
  for (const k of parent.keys()) result.set(k, find(k));
  return result;
};

// 機器のうち色を持つ端点（PC・サーバーはポート0、ルーターは各ポート）
const coloredPorts = (node: NetNode, data: EngineData): number[] => {
  const cat = data.categoryOf(node.device);
  if (cat === 'l2_switch') return [];
  if (cat === 'router') return Object.keys((node.colors ?? {})).map(Number);
  return (node.colors ?? {})[0] ? [0] : [];
};

// 固定設定のIPアドレスから色を決める。同じサブネットには同じ色を割り当てる
export const colorsFromConfig = (nodes: NetNode[]): NetNode[] => {
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

export interface Compiled {
  net: Network;
  issues: Record<string, Issue>;
  // L2スイッチの表示色（つながった機器の色。複数あれば最初の色）
  switchColors: Record<string, number>;
}

export const compile = (input: Network, data: EngineData): Compiled => {
  const dom = domains(input, data);
  const domainOf = (node: string, port: number) => dom.get(epKey(node, port)) ?? epKey(node, port);
  const cat = (n: NetNode) => data.categoryOf(n.device);
  const fixed = (n: NetNode) => n.configLocked && n.interfaces.length > 0;

  // 色ごとのサブネット。固定設定のある色はそのサブネットを使う
  const subnet = new Map<number, number>();
  for (const n of input.nodes) {
    if (!fixed(n)) continue;
    for (const i of n.interfaces) {
      const c = (n.colors ?? {})[i.port];
      if (c && !subnet.has(c)) subnet.set(c, networkOf(i.ip));
    }
  }
  const subnetOf = (c: number) => subnet.get(c) ?? ipToInt(`192.168.${100 + c}.0`);

  // 使用済みのアドレス
  const used = new Set<number>();
  for (const n of input.nodes) if (fixed(n)) for (const i of n.interfaces) used.add(ipToInt(i.ip));
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

  const sorted = [...input.nodes].sort((a, b) => (a.uid < b.uid ? -1 : 1));
  const ifaces = new Map<string, Iface[]>();
  // ルーターのポートは .1 から、PC・サーバーは .11 から割り当てる
  for (const n of sorted) {
    if (fixed(n)) {
      ifaces.set(n.uid, n.interfaces.map((i) => ({ ...i })));
      continue;
    }
    const list: Iface[] = [];
    for (const port of coloredPorts(n, data).sort((a, b) => a - b)) {
      const c = (n.colors ?? {})[port];
      list.push({ port, ip: alloc(c, cat(n) === 'router' ? 1 : 11), prefix: 24 });
    }
    ifaces.set(n.uid, list);
  }

  // ルーターのポート（ドメインと色ごと）
  const routerPorts: { node: NetNode; port: number; color: number; domain: string; ip: string }[] = [];
  for (const n of input.nodes) {
    if (cat(n) !== 'router') continue;
    for (const i of ifaces.get(n.uid)!) {
      routerPorts.push({ node: n, port: i.port, color: (n.colors ?? {})[i.port], domain: domainOf(n.uid, i.port), ip: i.ip });
    }
  }

  // ルート: ルーター同士が同じドメインの同じ色でつながっていれば隣接とし、幅優先探索で次のホップを決める
  const routes = new Map<string, Route[]>();
  for (const r of input.nodes.filter((n) => cat(n) === 'router')) {
    const direct = new Set(routerPorts.filter((p) => p.node.uid === r.uid).map((p) => p.color));
    const result: Route[] = [];
    const seenColors = new Set(direct);
    const visited = new Set([r.uid]);
    // [ルーター, 最初のホップのアドレス]
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

  // ドメインごとの色
  const domainColors = new Map<string, Set<number>>();
  for (const n of input.nodes) {
    for (const port of coloredPorts(n, data)) {
      const d = domainOf(n.uid, port);
      if (!domainColors.has(d)) domainColors.set(d, new Set());
      domainColors.get(d)!.add((n.colors ?? {})[port]);
    }
  }
  const allColors = new Set(input.nodes.flatMap((n) => coloredPorts(n, data).map((p) => (n.colors ?? {})[p])));

  const issues: Record<string, Issue> = {};
  const linkedPorts = (uid: string) =>
    input.links.flatMap((l) => [l.a, l.b]).filter((e) => e.node === uid).map((e) => e.port);

  const nodes: NetNode[] = input.nodes.map((n) => {
    const c = cat(n);
    if (c === 'l2_switch') return { ...n, interfaces: [], gateway: null, routes: [] };
    if (c === 'router') {
      if (linkedPorts(n.uid).some((p) => !(n.colors ?? {})[p])) issues[n.uid] = 'unset';
      for (const p of Object.keys((n.colors ?? {})).map(Number)) {
        if ((domainColors.get(domainOf(n.uid, p))?.size ?? 0) > 1) issues[n.uid] = 'mixed';
      }
      return { ...n, interfaces: ifaces.get(n.uid)!, gateway: null, routes: routes.get(n.uid)! };
    }
    // PC・サーバー
    const color = (n.colors ?? {})[0];
    let gateway = fixed(n) ? n.gateway : null;
    if (!color) {
      issues[n.uid] = 'unset';
    } else {
      const d = domainOf(n.uid, 0);
      if ((domainColors.get(d)?.size ?? 0) > 1) issues[n.uid] = 'mixed';
      if (!fixed(n)) {
        const gw = routerPorts.filter((p) => p.domain === d && p.color === color).sort((a, b) => ipToInt(a.ip) - ipToInt(b.ip))[0];
        gateway = gw?.ip ?? null;
      }
      if (allColors.size > 1 && !routerPorts.some((p) => p.domain === d && p.color === color) && !issues[n.uid]) {
        issues[n.uid] = 'no_gateway';
      }
    }
    return { ...n, interfaces: ifaces.get(n.uid)!, gateway, routes: [] };
  });

  const switchColors: Record<string, number> = {};
  for (const n of input.nodes) {
    if (cat(n) !== 'l2_switch') continue;
    const port = linkedPorts(n.uid)[0];
    const c = port === undefined ? undefined : domainColors.get(domainOf(n.uid, port));
    if (c && c.size) switchColors[n.uid] = [...c][0];
  }

  return { net: { nodes, links: input.links }, issues, switchColors };
};
