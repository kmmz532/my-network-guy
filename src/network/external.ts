import { analyze } from './engine/analyze';
import { makeIface } from './iface';
// 外部（インターネット）の表し方（N71・N72）。仮想のインターネットを、ルーターの空いている WAN の口（ポート0）につなぐ。
// 配線はプレイヤーが行わない（判定のときだけ使う）。ルーターの WAN の口に 198.51.100.0/24 の IPアドレスと既定の経路を設定すると、外部へ届く。
// 公開: インターネットから、サーバーへ HTTP（80）が届き、社内の PC へは外から届かないこと（NAT・ポート転送は扱わない）。
import { http, ping } from './engine';
import { isRoutingCategory } from './category';
import { CATEGORY, isPcCategory } from '../data/categories';
import type { EngineData, NetLink, NetNode, Network } from './types';
import { INTERNET_DEVICE, deviceCategory } from '../registry/query';

export const INTERNET_UID = '__internet';
export const INTERNET_IP = '198.51.100.1';
export const INTERNET_PREFIX = 24;
export const WAN_PORT = 0;
// 回線終端の口: 口0 はルーターの WAN 側、口1 は ISP（インターネット）側（N144）
export const UPLINK_ROUTER_PORT = 0;
export const UPLINK_ISP_PORT = 1;
export const PUBLIC_PORT = 80;

export interface OutsideCheck {
  // 仮想のインターネットを、ルーターにつなげたか（WAN の口が空いた、ルーターがある）
  attached: boolean;
  // 社内のすべての PC が、外部へ届く（PC がなければ false）
  pcsReachOutside: boolean;
  // 外部から届くサーバー（公開している）
  exposedServers: string[];
  // 外部から社内の PC へ届いてしまう（収入はなくなり、評判が下がる）
  leaks: boolean;
  // 公開の条件（HTTP 80）を持つサーバーの数（届くかは問わない）
  servers: number;
}

// ISP が BGP で広告する「インターネット」のネットワーク（TEST-NET-1）
export const INTERNET_NETWORK = '192.0.2.0';
export const INTERNET_NETWORK_PREFIX = 24;
// BGP の ISP は、ルーターとして動かす（BGP の計算がルーターだけを対象にするため）
const ISP_ROUTER_DEVICE = 'router_basic';

// 回線終端（uplink）ごとに、仮想の ISP（とインターネット）を加える（N144・NET.md §5.5）。回線終端の口1（ISP 側）につなぐ。
// 回線終端の口0 がルーターの WAN の口につながっていなければ、その回線は使えない。使える回線がなければ null。
// 最初の回線の ISP は INTERNET_UID、2つ目からは __internet_<回線終端の uid>。ISP の情報は回線終端の isp（省略すると既定の ISP）
export const withInternet = (net: Network, _data: EngineData): (Network & { internetUid: string; internetUids: string[] }) | null => {
  const nodes: NetNode[] = [];
  const links: NetLink[] = [];
  const uids: string[] = [];
  for (const uplink of net.nodes.filter((n) => deviceCategory(n.device) === CATEGORY.uplink)) {
    const routerLink = net.links.find((l) => (l.a.node === uplink.uid && l.a.port === UPLINK_ROUTER_PORT) || (l.b.node === uplink.uid && l.b.port === UPLINK_ROUTER_PORT));
    if (!routerLink) continue;
    const routerEnd = routerLink.a.node === uplink.uid ? routerLink.b : routerLink.a;
    const router = net.nodes.find((n) => n.uid === routerEnd.node);
    if (!router || !isRoutingCategory(deviceCategory(router.device))) continue;
    // 戻りの経路: 外部の側の既定のゲートウェイは、つないだルーターの WAN の IPアドレス（WAN に IPアドレスがなければ戻れない）
    const wanIp = router.interfaces.find((i) => i.port === routerEnd.port)?.ip ?? null;
    const uid = uids.length === 0 ? INTERNET_UID : `${INTERNET_UID}_${uplink.uid}`;
    const line = uplink.isp;
    const bgp = line?.asn !== undefined && router.bgp && wanIp ? { asn: line.asn, neighbors: [{ ip: wanIp, remoteAs: router.bgp.asn }], networks: [{ dest: INTERNET_NETWORK, prefix: INTERNET_NETWORK_PREFIX }] } : undefined;
    nodes.push({
      ports: [],
      uid,
      device: bgp ? ISP_ROUTER_DEVICE : INTERNET_DEVICE,
      // MAC アドレスの連番は、ISP ごとに大きな値から振る（機器の連番と重ならない）
      macSerial: 0xf000 + uids.length,
      x: 0,
      y: 0,
      locked: true,
      configLocked: true,
      interfaces: [makeIface(bgp ? ISP_ROUTER_DEVICE : INTERNET_DEVICE, 0, line?.ispIp ?? INTERNET_IP, line?.prefix ?? INTERNET_PREFIX)],
      gateway: wanIp,
      routes: [],
      services: [],
      ...(bgp ? { bgp } : {}),
    });
    links.push({
      uid: uids.length === 0 ? '__internet_link' : `__internet_link_${uplink.uid}`,
      cable: 'utp_cat5e',
      a: { node: uplink.uid, port: UPLINK_ISP_PORT },
      b: { node: uid, port: 0 },
      path: [
        [0, 0],
        [1, 0],
      ],
      paid: 0,
    });
    uids.push(uid);
  }
  if (uids.length === 0) return null;
  return { nodes: [...net.nodes, ...nodes], links: [...net.links, ...links], plans: net.plans, internetUid: uids[0], internetUids: uids };
};

// 外部への接続と、公開しているサーバー、社内への漏れを調べる
export const outsideCheck = (net: Network, data: EngineData): OutsideCheck => {
  const withNet = withInternet(net, data);
  if (!withNet) return { attached: false, pcsReachOutside: false, exposedServers: [], leaks: false, servers: 0 };
  const pcs = net.nodes.filter((n) => isPcCategory(deviceCategory(n.device)));
  const servers = net.nodes.filter((n) => deviceCategory(n.device) === 'server' && n.services.some((s) => s.protocol === 'http' && s.port === PUBLIC_PORT));
  const pcsReachOutside = pcs.length > 0 && pcs.every((pc) => withNet.internetUids.some((isp) => ping(analyze(withNet, data), pc.uid, isp).ok));
  // 外から社内の PC へ届くか（届けば、公開のサーバーがあっても収入はない）
  const leaks = pcs.some((pc) => withNet.internetUids.some((isp) => ping(analyze(withNet, data), isp, pc.uid).ok));
  const exposedServers = leaks ? [] : servers.filter((s) => withNet.internetUids.some((isp) => http(analyze(withNet, data), isp, s.uid, PUBLIC_PORT).ok)).map((s) => s.uid);
  return { attached: true, pcsReachOutside, exposedServers, leaks, servers: servers.length };
};

// 貸し出しの収入（N72）。公開しているサーバーの数と、会社のレベルの顧客数で、月の収入が決まる。
// 1日ごとに判定し、その日に届いたサーバーの分だけ入る（障害の日は入らない）。社内の PC へ外から届く（漏れ）ときは収入がなく、
// 公開のサーバーがあるときは、月末の判定で評判が1下がる。
export interface Rental {
  // 月の収入の見込み（今の状態のまま1か月続いたとき）
  monthly: number;
  // 1日の収入（月の収入を日数で割った額）
  daily: number;
  // 漏れがあり、公開のサーバーがある（月末に評判が1下がる）
  penalty: boolean;
  leaks: boolean;
  // 公開して届いているサーバーの数
  exposed: number;
}

// 顧客の数（会社のレベルで増える。levelsPerCustomer のレベルごとに1件増える）
export const customersOf = (level: number, levelsPerCustomer: number): number => 1 + Math.floor((level - 1) / levelsPerCustomer);

export const rentalOf = (
  net: Network,
  data: EngineData,
  rental: { monthlyPerCustomer: number; levelsPerCustomer: number },
  level: number,
  daysPerMonth: number,
): Rental => {
  const check = outsideCheck(net, data);
  const exposed = check.leaks ? 0 : check.exposedServers.length;
  const monthly = exposed * rental.monthlyPerCustomer * customersOf(level, rental.levelsPerCustomer);
  return {
    monthly,
    daily: Math.round(monthly / daysPerMonth),
    penalty: check.leaks && check.servers > 0,
    leaks: check.leaks,
    exposed,
  };
};
