import { makeIface } from './iface';
// 外部（インターネット）の表し方（N71・N72）。仮想のインターネットを、ルーターの空いている WAN の口（ポート0）につなぐ。
// 配線はプレイヤーが行わない（判定のときだけ使う）。ルーターの WAN の口に 198.51.100.0/24 の IPアドレスと既定の経路を設定すると、外部へ届く。
// 公開: インターネットから、サーバーへ HTTP（80）が届き、社内の PC へは外から届かないこと（NAT・ポート転送は扱わない）。
import { http, ping } from './engine';
import { isRoutingCategory } from './category';
import { isPcCategory } from '../data/categories';
import type { EngineData, NetLink, NetNode, Network } from './types';

export const INTERNET_UID = '__internet';
export const INTERNET_IP = '198.51.100.1';
export const INTERNET_PREFIX = 24;
export const WAN_PORT = 0;
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

// ネットワークに仮想のインターネットを加える。WAN の口が空いたルーターがなければ null
export const withInternet = (net: Network, data: EngineData): (Network & { internetUid: string }) | null => {
  const router = net.nodes.find(
    (n) => isRoutingCategory(data.categoryOf(n.device)) && !net.links.some((l) => (l.a.node === n.uid && l.a.port === WAN_PORT) || (l.b.node === n.uid && l.b.port === WAN_PORT)),
  );
  if (!router) return null;
  // 戻りの経路: 外部の側の既定のゲートウェイは、つないだルーターの WAN の IPアドレス（WAN に IPアドレスがなければ戻れない）
  const wanIp = router.interfaces.find((i) => i.port === WAN_PORT)?.ip ?? null;
  const internet: NetNode = {
    uid: INTERNET_UID,
    device: 'internet',
    x: 0,
    y: 0,
    locked: true,
    configLocked: true,
    interfaces: [makeIface('internet', 0, INTERNET_IP, INTERNET_PREFIX)],
    gateway: wanIp,
    routes: [],
    services: [],
  };
  const link: NetLink = {
    uid: '__internet_link',
    cable: 'utp_cat5e',
    a: { node: router.uid, port: WAN_PORT },
    b: { node: INTERNET_UID, port: 0 },
    path: [
      [0, 0],
      [1, 0],
    ],
    paid: 0,
  };
  return { nodes: [...net.nodes, internet], links: [...net.links, link], segments: net.segments, internetUid: INTERNET_UID };
};

// 外部への接続と、公開しているサーバー、社内への漏れを調べる
export const outsideCheck = (net: Network, data: EngineData): OutsideCheck => {
  const withNet = withInternet(net, data);
  if (!withNet) return { attached: false, pcsReachOutside: false, exposedServers: [], leaks: false, servers: 0 };
  const pcs = net.nodes.filter((n) => isPcCategory(data.categoryOf(n.device)));
  const servers = net.nodes.filter((n) => data.categoryOf(n.device) === 'server' && n.services.some((s) => s.protocol === 'http' && s.port === PUBLIC_PORT));
  const pcsReachOutside = pcs.length > 0 && pcs.every((pc) => ping(withNet, data, pc.uid, INTERNET_UID).ok);
  // 外から社内の PC へ届くか（届けば、公開のサーバーがあっても収入はない）
  const leaks = pcs.some((pc) => ping(withNet, data, INTERNET_UID, pc.uid).ok);
  const exposedServers = leaks ? [] : servers.filter((s) => http(withNet, data, INTERNET_UID, s.uid, PUBLIC_PORT).ok).map((s) => s.uid);
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
