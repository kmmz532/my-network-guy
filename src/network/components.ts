// 機器の単位の設定を、能力ごとのコンポーネントの表（NetNode.components）で持つ。
// 持てるコンポーネントは機器の定義（能力）が決め、持てない機器に付けようとすれば例外で止める。
import { z } from 'zod';
import type { Capability } from '../data/schema';
import { ipv4 } from '../data/schema';
import { can } from './capabilities';
import type { NetNode } from './types';
import { WIRELESS_SECURITIES } from './types';

// コンポーネントごとの zod のスキーマ。型もここから決める
export const COMPONENT_SCHEMAS = {
  // 回線終端（uplink）の回線の情報（ISP の名前・回線のネットワーク・ISP 側のアドレス・ISP の AS 番号・ISP の DNS）。省略すると、既定の ISP（198.51.100.1/24）
  isp: z.object({ name: z.string(), network: z.string(), prefix: z.number().int().min(8).max(30), ispIp: z.string(), asn: z.number().int().positive().optional(), dns: ipv4.optional() }),
  // OSPF の機器ごとの設定（routerId は省略すると自動。defaultOriginate は既定の経路を配る。process は router ospf の番号。省略は番号を書いていない）
  ospf: z.object({ routerId: ipv4.optional(), defaultOriginate: z.boolean().optional(), process: z.number().int().nonnegative().optional() }),
  // スパニングツリーのブリッジ優先度（既定 32768、4096 刻み。小さいほどルートになりやすい。省略は既定）
  stp: z.object({ priority: z.number().int().nonnegative() }),
  // BGP の設定（BGP を動かす機器だけ持つ。neighbors は隣接の相手、networks は広告する宛先）
  bgp: z.object({
    asn: z.number().int().nonnegative(),
    neighbors: z.array(z.object({ ip: ipv4, remoteAs: z.number().int().nonnegative(), nextHopSelf: z.boolean().optional(), localPref: z.number().int().optional(), med: z.number().int().optional(), prepend: z.number().int().nonnegative().optional() })),
    networks: z.array(z.object({ dest: ipv4, prefix: z.number().int().min(0).max(32) })),
  }),
  // 無線の設定（アクセスポイントは SSID・パスワード・チャネル・VLAN・MAC フィルター・暗号化の方式を持つ。無線の端末は SSID とパスワードを持ち、合うアクセスポイントにつながる）
  // macs は登録した端末の MAC だけを通す。省略なら制限しない。security の省略は wpa2。wpa2wpa3 は WPA2/WPA3 の移行モード
  wireless: z.object({
    ssid: z.string().optional(),
    password: z.string().optional(),
    channel: z.number().int().optional(),
    vlan: z.number().int().optional(),
    macs: z.array(z.string()).optional(),
    security: z.enum(WIRELESS_SECURITIES).optional(),
  }),
  // NAT の設定（napt は inside から outside へ出る通信の送信元を outside の口のアドレスに変える。statics は静的 NAT で、外の口へのこのポートの通信を、社内の宛先（アドレスとポート）へ届ける）
  nat: z.object({
    napt: z.boolean().optional(),
    statics: z.array(z.object({ port: z.number().int(), insideIp: ipv4, insidePort: z.number().int() })).optional(),
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
const REQUIRES: Partial<Record<ComponentId, Capability>> = {
  isp: 'wan',
  ospf: 'ospf',
  stp: 'stp',
  bgp: 'bgp',
  wireless: 'wireless',
  nat: 'nat',
};

export const getComponent = <K extends ComponentId>(node: NetNode, id: K): Components[K] => node.components?.[id];

// コンポーネントを付けた（置き換えた）機器を返す。機器の定義が許さなければ例外
export const withComponent = <K extends ComponentId>(node: NetNode, id: K, value: NonNullable<Components[K]>): NetNode => {
  const required = REQUIRES[id];
  if (required !== undefined && !can(node.device, required)) throw new Error(`機器 ${node.device} は ${id} のコンポーネントを持てない`);
  return { ...node, components: { ...node.components, [id]: COMPONENT_SCHEMAS[id].parse(value) } };
};
