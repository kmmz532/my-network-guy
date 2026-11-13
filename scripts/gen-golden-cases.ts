// 挙動の記録の試験で使う、乱数で作ったネットワークの構成（40件）を、1回だけ作って固定する。
// 使い方: npx vite-node scripts/gen-golden-cases.ts [開始の番号]。構成は src/__golden__/cases/random-<番号>.json に書く。
// 機器や論点を足しても、既存の40件は変わらない。足した論点の構成は、新しい番号のファイルとして足す（開始の番号を指定する）。
// 種は番号から決めるため、同じ番号は同じ構成になる。試験は生成器を呼ばず、書き出したファイルを読む。
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gameEnv } from '../src/sim/env';
import type { Iface, NetLink, NetNode, Network, PortConfig } from '../src/network/types';

const COUNT = 40;
const start = Number(process.argv[2] ?? 1);

// 種つきの乱数（mulberry32）
const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const POOL = ['pc_basic', 'pc_basic', 'laptop', 'pc_wifi', 'server_basic', 'router_basic', 'router_basic', 'l2_switch_8p', 'l2_switch_8p', 'l3_switch', 'access_point', 'home_router'];

const build = (n: number): Network => {
  const r = rng(1000 + n);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const chance = (p: number) => r() < p;
  const count = 4 + Math.floor(r() * 6);
  const nodes: NetNode[] = [];
  for (let i = 0; i < count; i++) {
    const device = pick(POOL);
    nodes.push({ uid: `n${i}`, device, macSerial: i + 1, ports: [], x: i * 2, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: device === 'server_basic' ? [{ protocol: 'http', port: 80 }] : [] } as NetNode);
  }
  const portsOf = (d: string) => gameEnv.devices[d]?.portCount ?? 0;
  const category = (d: string) => gameEnv.engine.categoryOf(d);
  // 配線: 機器の組をランダムに選び、空いている口どうしをつなぐ
  const used = new Set<string>();
  const links: NetLink[] = [];
  const free = (node: NetNode): number | null => {
    for (let p = 0; p < portsOf(node.device); p++) if (!used.has(`${node.uid}:${p}`)) return p;
    return null;
  };
  for (let k = 0; k < count + 2; k++) {
    const infra = nodes.filter((x) => ['l2_switch', 'l3_switch', 'router', 'home_router', 'access_point'].includes(category(x.device)));
    const a = pick(nodes);
    const b = infra.length > 0 && chance(0.75) ? pick(infra) : pick(nodes);
    if (a === b) continue;
    const pa = free(a);
    const pb = free(b);
    if (pa === null || pb === null) continue;
    used.add(`${a.uid}:${pa}`);
    used.add(`${b.uid}:${pb}`);
    links.push({ uid: `l${links.length}`, cable: 'utp_cat5e', a: { node: a.uid, port: pa }, b: { node: b.uid, port: pb }, path: [[a.x, 0], [b.x, 0]], paid: 0 });
  }
  const linked = (node: NetNode, port: number) => used.has(`${node.uid}:${port}`);
  // 多くのアドレスを同じネットワーク（10.0.1.0/24）に置き、疎通が通る構成も作る
  const net24 = () => (chance(0.8) ? 1 : pick([0, 2, 3]));
  let host = 10;
  for (const node of nodes) {
    const cat = category(node.device);
    const isEnd = cat === 'pc' || cat === 'server';
    const isRouter = cat === 'router' || cat === 'home_router' || cat === 'l3_switch';
    // アドレス: 端末は口0、ルーターはつながった口ごと（L3スイッチは SVI）
    const mk = (id: string, port: number, subnet: number, last: number, extra: Partial<Iface> = {}): Iface => ({ id, kind: 'port', port, ip: `10.0.${subnet}.${last}`, prefix: 24, ...extra });
    if (isEnd || cat === 'laptop') {
      const subnet = net24();
      const dhcpClient = chance(0.3);
      node.interfaces = [mk('eth0', 0, subnet, host++, dhcpClient ? { dhcp: true } : {})];
      node.gateway = chance(0.7) ? `gw:${subnet}` : null;
    } else if (isRouter && cat !== 'l3_switch') {
      for (let p = 0; p < portsOf(node.device); p++) if (linked(node, p) && chance(0.8)) node.interfaces.push(mk(`g0/${p}`, p, net24(), host++, { ...(chance(0.15) ? { rip: true } : {}), ...(chance(0.25) ? { ospf: { area: 0 } } : {}), ...(chance(0.15) ? { helper: '10.0.0.2' } : {}) }));
      if (chance(0.3)) node.routes.push({ dest: `10.0.${net24()}.0`, prefix: 24, nextHop: `10.0.${net24()}.2` });
      if (chance(0.15) && node.interfaces.length >= 2) {
        node.napt = true;
        node.interfaces[0].nat = 'outside';
        node.interfaces[1].nat = 'inside';
      }
      if (chance(0.15) && node.interfaces.length > 0) node.interfaces[0].vrrp = [{ vrid: 1, ip: `10.0.${node.interfaces[0].ip.split('.')[2]}.254`, priority: chance(0.5) ? 110 : 100, preempt: true }];
      if (chance(0.1) && node.device === 'router_basic') node.bgp = { asn: 64512, neighbors: [{ ip: '10.0.0.2', remoteAs: 65001 }], networks: [] };
    } else if (cat === 'l3_switch') {
      for (const vlan of [10, 20]) if (chance(0.5)) node.interfaces.push({ id: `vlan${vlan}`, kind: 'svi', port: 1000 + vlan, vlan, ip: `10.0.${vlan}.1`, prefix: 24 });
    }
    // スイッチの口: VLAN・trunk・LAG・スパニングツリー
    if (cat === 'l2_switch' || cat === 'l3_switch') {
      const ports: PortConfig[] = [];
      for (let p = 0; p < portsOf(node.device); p++) {
        if (!linked(node, p)) continue;
        if (chance(0.35)) ports.push({ port: p, mode: 'access', vlan: pick([10, 20]) });
        else if (chance(0.15)) ports.push({ port: p, mode: 'trunk', allowed: chance(0.5) ? [10, 20] : [10] });
      }
      if (chance(0.2)) for (const p of [0, 1]) if (linked(node, p)) ports.push({ port: p, mode: 'access', channelGroup: 1, lacp: pick(['active', 'passive', 'on'] as const) });
      node.ports = ports.filter((c, i) => ports.findIndex((x) => x.port === c.port) === i);
      if (chance(0.2)) node.stpPriority = pick([4096, 8192, 32768]);
    }
    // サービス・無線
    if (cat === 'server' && chance(0.5)) node.dhcpPools = [{ network: '10.0.1.0', prefix: 24, start: '10.0.1.100', end: '10.0.1.110', gateway: '10.0.1.1' }];
    if (cat === 'access_point' || cat === 'home_router') node.wireless = { ssid: 'g', password: 'golden-pass', security: pick(['open', 'wep', 'wpa2', 'wpa3', 'wpa2wpa3'] as const) };
    if (node.device === 'laptop' || node.device === 'pc_wifi') node.wireless = { ssid: 'g', password: chance(0.8) ? 'golden-pass' : 'wrong-pass' };
  }
  // ゲートウェイは、同じネットワークのルーターの口のアドレス（なければ未設定）
  for (const node of nodes) {
    if (!node.gateway?.startsWith('gw:')) continue;
    const subnet = node.gateway.slice(3);
    const router = nodes.flatMap((x) => (['router', 'home_router'].includes(category(x.device)) ? x.interfaces : [])).find((i) => i.ip.startsWith(`10.0.${subnet}.`));
    node.gateway = router?.ip ?? null;
  }
  return { nodes, links, segments: {} };
};

for (let n = start; n < start + COUNT; n++) {
  const file = join('src/__golden__/cases', `random-${String(n).padStart(3, '0')}.json`);
  writeFileSync(file, `${JSON.stringify(build(n), null, 2)}\n`);
}
console.log(`${COUNT} 件を書き出した（番号 ${start} から）`);
