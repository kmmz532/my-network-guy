// 配置された機器と配線の形式（セーブデータとシミュレーションの入力を兼ねる）
import type { VrrpGroup } from './vrrp';
import type { DhcpPool } from './dhcp';
export type { VrrpGroup } from './vrrp';
export type { DhcpPool } from './dhcp';

// インターフェース（IPアドレスを持つ場所）。口（port）とは別に、名前（id）と種類（kind）を持つ（N135）
export interface Iface {
  // 名前（eth0・g0/1 など。画面とターミナルで同じ名前を出す）
  id: string;
  // 種類: port（口のインターフェース）・svi（VLAN のインターフェース・N138）。sub・lan は後続
  kind: 'port' | 'svi';
  // 口の番号（svi は判定の中だけの仮想の口・SVI_PORT_BASE + VLAN）
  port: number;
  // svi のときの VLAN 番号
  vlan?: number;
  ip: string;
  prefix: number;
  // NAT の役割（N145）: inside（社内の側）・outside（外の側）
  nat?: 'inside' | 'outside';
  // RIP に参加しているか（N141b）
  rip?: boolean;
  // 自動（DHCP）で受け取る口（ip は空。実際のアドレスは DHCP の割り当てから毎回求める。NET.md §5.7）
  dhcp?: boolean;
  // DHCP のリレー先のサーバーのアドレス（ip helper-address。ルーター・L3スイッチの口）
  helper?: string;
  // VRRP のグループ（NET.md §5.12）。routed の口・SVI・サブインターフェースごとに持つ
  vrrp?: VrrpGroup[];
  // OSPF に参加しているエリアとコスト（N142・MVP はエリア 0 だけ）
  // priority は DR の選出の優先度（既定 1。0 は選ばれない）、hello・dead は秒（既定 10・40）
  ospf?: { area: number; cost?: number; priority?: number; hello?: number; dead?: number };
}

export interface Route {
  dest: string;
  prefix: number;
  nextHop: string;
  // 経路の出どころ（static は設定した経路。省略は static）。同じ宛先の長さなら管理距離（AD）の小さいものを使う
  protocol?: 'static' | 'rip' | 'ospf' | 'bgp';
  // 動的経路のメトリック（RIP は跳ね数、OSPF はコストの合計）。show ip route の [管理距離/メトリック] に出す
  metric?: number;
  // OSPF で、自分が参加していないエリアの経路（エリアの間の経路。O IA）
  interArea?: boolean;
  // iBGP で学んだ経路（管理距離 200）
  ibgp?: boolean;
}

export interface Service {
  protocol: 'http';
  port: number;
}

// 機器ごとの対応表の1行（名前 → IPアドレス）。Debian の /etc/hosts と同じ考え方で、ping・traceroute の宛先の名前を引くのに使う
export interface HostEntry {
  name: string;
  ip: string;
}

// ファイアウォールの規則（N38）。送信元・宛先は 'any' か「a.b.c.d/nn」のネットワーク。service は any・ping・http（http は port で絞れる）
export interface FirewallRule {
  src: string;
  dst: string;
  service: 'any' | 'ping' | 'http';
  port?: number;
}

// 口の設定（NET.md §3）。設定のない口は、機器の既定のモードで動く。N135 の後半で、設定を画面から変えられるようにする
export interface PortConfig {
  port: number;
  mode: 'access' | 'trunk' | 'routed';
  vlan?: number;
  allowed?: number[];
  native?: number;
  shutdown?: boolean;
  stpCost?: number;
  // リンクアグリゲーション（NET.md §5.1）: チャネルの番号と、まとめるモード。両端が同じ番号で、モードが組み合わさるとまとまる
  channelGroup?: number;
  lacp?: 'active' | 'passive' | 'on';
  // ポートセキュリティ（N153）: 登録した MAC アドレスの機器だけを通す。省略なら制限しない
  macs?: string[];
}

// BGP の設定（MVP は eBGP の隣接と、宛先の広告・AS パスで選ぶ経路。N147）
export interface BgpConfig {
  asn: number;
  // nextHopSelf: iBGP の相手へ、自分のアドレスをネクストホップにして広告する。localPref・med: この相手から受け取る経路の属性。prepend: この相手へ広告するときに自分の AS を足す回数
  neighbors: { ip: string; remoteAs: number; nextHopSelf?: boolean; localPref?: number; med?: number; prepend?: number }[];
  networks: { dest: string; prefix: number }[];
}

// 回線の情報。asn があれば、ISP は BGP で経路をやり取りする（自社のルーターの AS 番号を相手として持つ）
export interface IspLine {
  name: string;
  network: string;
  prefix: number;
  ispIp: string;
  asn?: number;
}

export interface NetNode {
  uid: string;
  device: string;
  // 回線終端（uplink）の回線の情報（ISP の名前・回線のネットワーク・ISP 側のアドレス・ISP の AS 番号）。省略すると、既定の ISP（198.51.100.1/24）
  isp?: IspLine;
  // 機器の電源。false なら、すべての口が停止したものとして扱う（省略は入）
  powered?: boolean;
  // DHCP のプール（サーバーだけが持つ。口のアドレスがプールのネットワークの中にある口で配る）
  dhcpPools?: DhcpPool[];
  // スパニングツリーのブリッジ優先度（既定 32768、4096 刻み。小さいほどルートになりやすい）
  stpPriority?: number;
  // OSPF の機器ごとの設定（routerId は省略すると自動。defaultOriginate は既定の経路を配る）
  ospf?: { routerId?: string; defaultOriginate?: boolean };
  // BGP の設定（BGP を動かす機器だけ持つ）
  bgp?: BgpConfig;
  // 口の設定（機器ごと。設定のない口は既定のモード）
  ports: PortConfig[];
  // 無線の設定（N151）。アクセスポイントは SSID・パスワード・チャネル・VLAN を持つ。無線の端末は SSID とパスワードを持ち、合うアクセスポイントにつながる
  // macs は無線の MAC フィルター（N153）: 登録した端末の MAC だけを通す。省略なら制限しない
  wireless?: { ssid?: string; password?: string; channel?: number; vlan?: number; macs?: string[] };
  // NAPT を行う（inside から outside へ出る通信の送信元を、outside の口のアドレスに変える・N145）
  napt?: boolean;
  // 静的 NAT（ポートの転送・N145）: 外の口へのこのポートの通信を、社内の宛先（アドレスとポート）へ届ける
  statics?: { port: number; insideIp: string; insidePort: number }[];
  // ホスト名（ターミナルのプロンプトと show running-config に出す。画面の名前とは別。N46）
  hostname?: string;
  // ファイアウォールの規則（ファイアウォールだけが持つ。一覧にない通信は通さない）
  rules?: FirewallRule[];
  // 手で付けた名前（なければ既定の名前で呼ぶ。nodeName.ts）
  name?: string;
  x: number;
  y: number;
  // 配置を動かせない（案件で固定された機器）
  locked: boolean;
  // 設定（IPアドレスなど）を変えられない
  configLocked: boolean;
  interfaces: Iface[];
  gateway: string | null;
  routes: Route[];
  services: Service[];
  // 名前と IPアドレスの対応表（ping・traceroute の宛先の名前を引く）。移行前のセーブは空
  hosts?: HostEntry[];
  // ネームサーバー（ip name-server）の IPアドレス。機器の対応表で引けない名前を、この DNS サーバーに問い合わせる（N68）
  nameServer?: string;
  // DNS の役割（サーバーだけが持つ）。zone は名前と IPアドレスの表（N68）
  dns?: { zone: HostEntry[] };
  // MAC アドレスの機器ごとの連番（機器を置いたときに決める。mac.ts）（N69）
  macSerial?: number;
}

export interface Endpoint {
  node: string;
  port: number;
}

export interface NetLink {
  uid: string;
  cable: string;
  a: Endpoint;
  b: Endpoint;
  path: [number, number][];
  // 実際に払った額（割引のあとの額の合計。配線・移動・挿し替えの差額で増減する）。撤去の返金はこの額を使う（N113）
  paid: number;
}

// セグメントの設定（ネットワークアドレスとプレフィックス長）
export interface SegmentConfig {
  network: string;
  prefix: number;
}

export interface Network {
  nodes: NetNode[];
  links: NetLink[];
  // セグメントの設定（代表端点の鍵 "uid:port" → 設定）。省略すると設定はない
  segments?: Record<string, SegmentConfig>;
}

// 判定に必要なデータ（機材の種類と、ケーブルの上限長）
export interface EngineData {
  categoryOf: (device: string) => string;
  maxLengthOf: (cable: string) => number;
  // 壁のマスか（電波の減衰・N151）。省略すると壁はないものとして数える
  wallAt?: (x: number, y: number) => boolean;
}

// 疎通の失敗の理由。文言は言語ファイルの error.<理由> と error.<理由>.fix に置く
export const FAILURE_REASONS = [
  'link.unplugged',
  // DHCP サーバーが見つからず、アドレスを受け取れない（NET.md §5.7）
  'dhcp.no_offer',
  // DHCP のプールのアドレスが足りない
  'dhcp.exhausted',
  // 無線の端末がアクセスポイントにつながっていない（SSID・パスワードが合わない、電波の範囲の外）。ケーブルの失敗とは分ける
  'wireless.unassociated',
  // ポートセキュリティ: 登録のない MAC の機器がつながり、その口が止まった（N153）
  'port.security',
  // OSPF に参加しているのに、宛先への経路を得られない（隣接がない。route.none の OSPF の場合・N142）
  'ospf.no_neighbor',
  // BGP の相手のアドレスか AS 番号が合わず、隣接しない（N147）
  'bgp.no_session',
  // 同じ VRID の全員が止まっている（仮想の IP アドレスをゲートウェイにした端末からの通信・NET.md §5.12）
  'vrrp.no_master',
  // iBGP で学んだ経路のネクストホップに届かない（next-hop-self がない・NET.md §5.5）
  'bgp.nexthop_unreachable',
  // 社内のアドレスのまま外の口へ出た（NAPT がない・NET.md §6）
  'nat.private_source',
  // RIP の経路が 16 ホップ以上で届かない（N141b）
  'rip.unreachable',
  // 外から NAT のルーターの外の口へ来た通信に、静的 NAT の転送先がない（NET.md §6）
  'nat.no_forward',
  // エリア 0 に接していないエリアの経路が届かない（NET.md §6）
  'ospf.area_detached',
  // 口が停止している（shutdown・N137）
  'port.shutdown',
  // 口の VLAN が通らない（access と trunk の許可の不一致・N137）
  'vlan.not_allowed',
  // そのサブネットのインターフェースがない（RIP・OSPF の network 文・N143）
  'iface.none',
  // 回線終端を、回線の能力のない機器につないだ（N144）
  'uplink.no_wan',
  // ケーブルの口の種類が、機器の口と合わない（光ファイバーは sfp の口だけ・N-sfp）
  'cable.port_type',
  'link.too_long',
  'link.loop',
  'ip.unset',
  'ip.duplicate',
  'ip.unreachable',
  'gateway.unset',
  'gateway.unreachable',
  'route.none',
  'route.loop',
  'return.failed',
  'service.closed',
  // ファイアウォールの規則に合わない通信（既定は拒否）
  'firewall.denied',
  // ケーブルが上限の長さを超えている（N49）
  'cableTooLong',
  // 名前（ホスト名）を引けない（対応表にもネームサーバーにもない、またはネームサーバーまで届かない）（N68）
  'name.unresolved',
] as const;

export type FailureReason = (typeof FAILURE_REASONS)[number];

export interface Failure {
  reason: FailureReason;
  node: string;
  // return.failed のときに、復路で起きた失敗
  cause?: Failure;
}

export interface PathResult {
  ok: boolean;
  // 往路で通過した機器のuid（L2スイッチは含めない）
  path: string[];
  failure?: Failure;
  // NAPT で送信元を書き換えた（N145）: 書き換えた機器・社内のアドレス・外のアドレス
  nat?: { router: string; insideIp: string; outsideIp: string };
  // 静的 NAT で、外から社内のサーバーへの宛先を変換した（宛先の変換: 外のアドレス → 社内のアドレス）
  staticNat?: { router: string; insideIp: string; outsideIp: string };
  // 復路の経路（機器の uid の列）。復路まで通ったときだけ持つ
  back?: string[];
}
