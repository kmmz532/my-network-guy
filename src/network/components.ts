// 機器の単位の設定を、能力ごとのコンポーネントの表（NetNode.components）で持つ。
// 持てるコンポーネントは機器の定義（能力）が決め、持てない機器に付けようとすれば例外で止める。
import { z } from 'zod';
import type { Capability } from '../data/schema';
import { ipv4, vpnTunnelSchema, WIRELESS_BANDS } from '../data/schema';
import { can } from './capabilities';
import type { NetNode } from './types';
import { WIRELESS_SECURITIES } from './types';

// コンポーネントごとの zod のスキーマ。型もここから決める
export const COMPONENT_SCHEMAS = {
  // 回線終端（uplink）の回線の情報（ISP の名前・回線のネットワーク・ISP 側のアドレス・ISP の AS 番号・ISP の DNS）。省略すると、既定の ISP（198.51.100.1/24）
  isp: z.object({ name: z.string(), network: z.string(), prefix: z.number().int().min(8).max(30), ispIp: z.string(), asn: z.number().int().positive().optional(), dns: ipv4.optional() }),
  // OSPF の機器ごとの設定（routerId は省略すると自動。defaultOriginate は既定の経路を配る。process は router ospf の番号。省略は番号を書いていない。networks は network 文の記録で、口のアドレスが prefix とワイルドカードで一致した口がその文の area で参加する）
  ospf: z.object({
    routerId: ipv4.optional(),
    defaultOriginate: z.boolean().optional(),
    // コストを求める基準の帯域（Mbps）。省略は 100
    referenceBandwidth: z.number().int().positive().optional(),
    process: z.number().int().nonnegative().optional(),
    networks: z.array(z.object({ prefix: ipv4, wildcard: ipv4, area: z.number().int().nonnegative() })).optional(),
  }),
  // スパニングツリーのブリッジ優先度（既定 32768、4096 刻み。小さいほどルートになりやすい。省略は既定）
  stp: z.object({ priority: z.number().int().nonnegative() }),
  // BGP の設定（BGP を動かす機器だけ持つ。neighbors は隣接の相手、networks は広告する宛先）
  bgp: z.object({
    asn: z.number().int().nonnegative(),
    neighbors: z.array(z.object({ ip: ipv4, remoteAs: z.number().int().nonnegative(), nextHopSelf: z.boolean().optional(), localPref: z.number().int().optional(), med: z.number().int().optional(), prepend: z.number().int().nonnegative().optional() })),
    networks: z.array(z.object({ dest: ipv4, prefix: z.number().int().min(0).max(32) })),
  }),
  // 無線の設定（アクセスポイントは SSID・パスワード・帯（band。必須）・チャネル・VLAN・MAC フィルター・暗号化の方式を持つ。無線の端末は SSID とパスワードを持ち、合うアクセスポイントにつながる）
  // macs は登録した端末の MAC だけを通す。省略なら制限しない。security の省略は wpa2。wpa2wpa3 は WPA2/WPA3 の移行モード
  wireless: z.object({
    ssid: z.string().optional(),
    password: z.string().optional(),
    band: z.enum(WIRELESS_BANDS).optional(),
    channel: z.number().int().optional(),
    vlan: z.number().int().optional(),
    macs: z.array(z.string()).optional(),
    security: z.enum(WIRELESS_SECURITIES).optional(),
    // 802.1X（security が wpa2_eap・wpa3_eap）の認証を任せる RADIUS サーバーのアドレス
    radius: ipv4.optional(),
  }),
  // NAT の設定（napt は inside から outside へ出る通信の送信元を outside の口のアドレスに変える。statics は静的 NAT で、外の口へのこのポートの通信を、社内の宛先（アドレスとポート）へ届ける）
  nat: z.object({
    napt: z.boolean().optional(),
    statics: z.array(z.object({ port: z.number().int(), insideIp: ipv4, insidePort: z.number().int() })).optional(),
  }),
  // ファイアウォールの規則（許可する通信。一覧にない通信は通さない。送信元・宛先は 'any' か「a.b.c.d/nn」。http は port で絞れる。dns は 53 番）
  firewall: z.array(z.object({ src: z.string(), dst: z.string(), service: z.enum(['any', 'ping', 'http', 'dns', 'radius']), port: z.number().int().optional() })),
  // ロードバランサーの仮想サーバーの一覧（vip はロードバランサーの口のアドレス、port は HTTP のサービスのポート。members は振り分け先、method は選び方、healthCheck は振り分け先の健全の確かめ方、snat は振り分け先へ届く通信の送信元をロードバランサーのアドレスにするか）
  loadBalancer: z.array(
    z.object({
      vip: ipv4,
      port: z.number().int().min(1).max(65535),
      members: z.array(z.object({ ip: ipv4, port: z.number().int().min(1).max(65535) })).min(1),
      method: z.enum(['round_robin', 'source_ip']),
      healthCheck: z.enum(['none', 'ping', 'http']),
      snat: z.boolean(),
    }),
  ),
  // IPsec VPN のトンネルの一覧（peer は相手の WAN のアドレス、psk は事前共有鍵、cipher は暗号の方式、local は自拠点の LAN、remote は相手の LAN で、どちらも a.b.c.d/nn）
  vpn: z.array(vpnTunnelSchema),
  // 名前の引き方（hosts は機器ごとの対応表で、ping・traceroute の宛先の名前を引く。Debian の /etc/hosts と同じ考え方。nameServer は ip name-server の DNS サーバーで、対応表で引けない名前を問い合わせる）
  resolver: z.object({
    hosts: z.array(z.object({ name: z.string(), ip: ipv4 })).optional(),
    nameServer: ipv4.optional(),
  }),
  // プロキシの利用側（ブラウザの設定）。proxy を持つ端末の HTTP は、まずそのプロキシへ届ける。pac の direct は、プロキシを通さず直接つなぐ名前の接尾辞（例 ".corp.example"）
  proxyClient: z.object({
    proxy: z.object({ ip: ipv4, port: z.number().int().min(1).max(65535) }).optional(),
    pac: z.object({ direct: z.array(z.string().min(1)) }).optional(),
  }),
  // DHCP のプール（サーバーが配る範囲。口のアドレスがプールのネットワークの中にある口で配る）
  dhcpServer: z.array(
    z.object({
      network: ipv4,
      prefix: z.number().int().min(0).max(32),
      start: ipv4,
      end: ipv4,
      gateway: ipv4.optional(),
      dns: ipv4.optional(),
      excluded: z.array(z.object({ start: ipv4, end: ipv4 })).optional(),
    }),
  ),
};

export type ComponentId = keyof typeof COMPONENT_SCHEMAS;
export type Components = { [K in ComponentId]?: z.infer<(typeof COMPONENT_SCHEMAS)[K]> };

// コンポーネントを持てる条件（機器の定義の能力）。条件のないものは、どの機器にも付けられる
export const REQUIRES: Partial<Record<ComponentId, Capability>> = {
  isp: 'wan',
  ospf: 'ospf',
  stp: 'stp',
  bgp: 'bgp',
  wireless: 'wireless',
  nat: 'nat',
  firewall: 'firewall',
  loadBalancer: 'loadBalance',
  vpn: 'vpn',
};

export const getComponent = <K extends ComponentId>(node: NetNode, id: K): Components[K] => node.components?.[id];

// コンポーネントを付けた（置き換えた）機器を返す。機器の定義が許さなければ例外
export const withComponent = <K extends ComponentId>(node: NetNode, id: K, value: NonNullable<Components[K]>): NetNode => {
  const required = REQUIRES[id];
  if (required !== undefined && !can(node.device, required)) throw new Error(`機器 ${node.device} は ${id} のコンポーネントを持てない`);
  return { ...node, components: { ...node.components, [id]: COMPONENT_SCHEMAS[id].parse(value) } };
};
