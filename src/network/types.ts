// 配置された機器と配線の形式（セーブデータとシミュレーションの入力を兼ねる）
import type { VrrpGroup } from './vrrp';
import type { Components } from './components';
export type { VrrpGroup } from './vrrp';
export type { DhcpPool } from './dhcp';

// インターフェース（IPアドレスを持つ場所）。口（port）とは別に、名前（id）と種類（kind）を持つ（N135）
// po のインターフェースが持つ口の番号（物理の口ではない印）
export const PO_PORT = -1;

// 口の MTU の範囲（バイト）と既定値
export const MTU_MIN = 576;
export const MTU_MAX = 9000;
export const MTU_DEFAULT = 1500;

export interface Iface {
  // 名前（eth0・g0/1 など。画面とターミナルで同じ名前を出す）
  id: string;
  // 種類: port（口のインターフェース）・svi（VLAN のインターフェース・N138）・po（束ねた口。チャネルの番号で持ち、
  // 計算の入口（resolvePo）で、まとまった配線の代表の口の port に読み替える）。sub・lan は後続
  kind: 'port' | 'svi' | 'po';
  // 口の番号（svi は判定の中だけの仮想の口・SVI_PORT_BASE + VLAN。po は物理の口を持たず PO_PORT。読み替えの後の構成には po は残らない）
  port: number;
  // svi のときの VLAN 番号
  vlan?: number;
  // po のときのチャネルの番号（口の設定の channelGroup と同じ）
  channel?: number;
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
  // 口の MTU（バイト。省略は 1500。設定できる範囲は 576〜9000）。区間の MTU は両端の口の小さい方
  mtu?: number;
  // ip tcp adjust-mss: この口を通る HTTP の大きさを、この値 + 40 に抑える（ping には効かない）
  adjustMss?: number;
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

// DNS のレコード（ゾーンの1行）。pref は MX だけが持つ優先度
export type DnsRecordType = 'A' | 'AAAA' | 'CNAME' | 'MX' | 'NS' | 'PTR';
export interface DnsRecord {
  type: DnsRecordType;
  name: string;
  value: string;
  pref?: number;
}

// 機器が動かすサービス。DNS は 53 番で待ち受ける。auth は自分のゾーンだけを答え、cache はゾーンにない名前を forwarder（転送先の DNS の IP）へ聞く
export type Service =
  | { protocol: 'http'; port: number }
  // RADIUS は UDP 1812 に固定
  | { protocol: 'radius' }
  | { protocol: 'dns'; role: 'auth' | 'cache'; zone: DnsRecord[]; forwarder?: string };
export type DnsService = Extract<Service, { protocol: 'dns' }>;
export const DNS_PORT = 53;

// 機器ごとの対応表の1行（名前 → IPアドレス）。Debian の /etc/hosts と同じ考え方で、ping・traceroute の宛先の名前を引くのに使う
export interface HostEntry {
  name: string;
  ip: string;
}

// ファイアウォールの規則（N38）。送信元・宛先は 'any' か「a.b.c.d/nn」のネットワーク。service は any・ping・http・dns（http は port で絞れる。dns は 53 番）
export interface FirewallRule {
  src: string;
  dst: string;
  service: 'any' | 'ping' | 'http' | 'dns' | 'radius';
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
  // ISP の DNS の IP（省略は、回線の DNS がない）
  dns?: string;
}

// wpa2_eap・wpa3_eap は 802.1X（RADIUS による認証）。パスワードの一致は求めない
export const WIRELESS_SECURITIES = ['open', 'wep', 'wpa', 'wpa2', 'wpa3', 'wpa2wpa3', 'wpa2_eap', 'wpa3_eap'] as const;
export type WirelessSecurity = (typeof WIRELESS_SECURITIES)[number];

export interface NetNode {
  uid: string;
  device: string;
  // 機器の電源。false なら、すべての口が停止したものとして扱う（省略は入）
  powered?: boolean;
  // 機器の単位の設定を、能力ごとのコンポーネントで持つ（持てるものは機器の定義が決める。components.ts）
  components?: Components;
  // 口の設定（機器ごと。設定のない口は既定のモード）
  ports: PortConfig[];
  // ホスト名（ターミナルのプロンプトと show running-config に出す。画面の名前とは別。N46）
  hostname?: string;
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

// アドレスの計画（L2 ドメインのネットワークアドレスとプレフィックス長）
export interface NetworkPlan {
  network: string;
  prefix: number;
}

// L2 ドメインの鍵（ドメインの中で配線でつながった最も小さい機器の uid と口の番号、"uid:port"）
export type DomainKey = string;

export interface Network {
  nodes: NetNode[];
  links: NetLink[];
  // アドレスの計画（L2 ドメインの鍵 → 計画）。省略すると計画はない
  plans?: Record<DomainKey, NetworkPlan>;
}

// 判定に必要な、世界ごとに違うデータ（機器・ケーブルの定義は登録表から引く）
export interface EngineData {
  // 壁のマスか（電波の減衰・N151）。壁のない場面は () => false を渡す
  wallAt: (x: number, y: number) => boolean;
  // 干渉源（電子レンジなど）の家具のマス。干渉源のない場面は [] を渡す
  interferers: readonly { x: number; y: number }[];
}

// 疎通の失敗の理由。文言は言語ファイルの error.<理由> と error.<理由>.fix に置く
export const FAILURE_REASONS = [
  'link.unplugged',
  // 無線: パスワードが合わない・暗号化の方式が合わない（端末が WPA3 に対応しない）・帯が合わない（端末がアクセスポイントの帯に対応しない）
  'wlan.psk_mismatch',
  'wlan.auth_mismatch',
  'wlan.band_mismatch',
  // 802.1X の SSID で、アクセスポイントから RADIUS サーバー（UDP 1812）へ届かない（アドレスの未設定・届かない・radius のサービスがない）
  'wlan.no_radius',
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
  // Ping は届くが、通り道に指定の速さに足りない区間がある
  'speed.slow',
  'link.loop',
  'ip.unset',
  // 束ねた口（Po）がまとまっていない（メンバーの口のチャネルの番号・モードが相手と合わない）。Po は落ちた口になる
  'po.not_bundled',
  'ip.duplicate',
  'ip.duplicate.dhcp',
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
  // ロードバランサー: 選んだ振り分け先が止まっている（ヘルスチェックがなく、届かない・サービスがない）
  'lb.member_down',
  // ロードバランサー: 健全な振り分け先が1つもない
  'lb.no_healthy_member',
  // ロードバランサー: SNAT がなく、サーバーから利用者への戻りがロードバランサーを通らない
  'lb.asymmetric',
  // 達成条件 load_balanced: 届くが、健全な振り分け先の数が指定に足りない（札はロードバランサー）
  'lb.few_healthy',
  // IPsec VPN: 相手の WAN のアドレスに届かない（相手の機器がない・相手がこちらを peer にしていない・UDP 500 が途中で止まる）
  'vpn.peer_unreachable',
  // IPsec VPN: 事前共有鍵が両端で違う
  'vpn.psk_mismatch',
  // IPsec VPN: 暗号の方式が両端で違う
  'vpn.proposal_mismatch',
  // IPsec VPN: 守るネットワークの組（自拠点と相手）が左右対称でない
  'vpn.selector_mismatch',
  // IPsec VPN: トンネルへ入る前に、手前の NAPT が送信元を変えている
  'vpn.nat_before_tunnel',
  // 通信が区間の MTU より大きく、DF（分割禁止）が付いている。札は、その区間の入口の機器
  'mtu.exceeded',
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
  // IPsec のトンネルを通った区間（path の中で隣り合う ingress と egress の間）。外側の宛先は egressIp（相手の WAN）、中身は元の通信
  tunnel?: { ingress: string; egress: string; ingressIp: string; egressIp: string };
  // 区間（path の隣り合う2台の間）ごとの分割の数（MTU を超えて分割された区間は 2 以上、そのまま通る区間は 1）。分割がなければ持たない
  fragments?: number[];
  // 復路の区間ごとの分割の数
  backFragments?: number[];
}
