// アドレスの層: 実効の口のアドレス・端末のゲートウェイの補完・L2 の機器と中継だけの口のアドレスの除去・設計の不備（issues）。
// セグメントの設定と機器の設定（IPアドレス・ルート）から求める。IPアドレスの未設定や設定の不備は、機器ごとの issues として返す。
// 層の順序: 配線の層・L2 の層の後に置く。L2 の層は、口にアドレスが残るか（中継だけの口ではないか）で口の扱いを変えるが、
// その規則（isRelayPort）は機器の種類と口の番号だけで決まるため、L2 の層は保存の構成に同じ規則を当てて求め、この層の結果を読まない
import { inSubnet, ipToInt } from '../../engine';
import { isL2Category, isRelayPort, isRoutingCategory } from '../../category';
import { epKey, hostCapacity, segmentConfigOf, segmentsOf, type Segment } from '../../segments';
import type { EngineData, Iface, NetNode, Network, SegmentConfig } from '../../types';
import { deviceCategory } from '../../../registry/query';
import type { LinkLayer } from './links';

// 機器の不備の種類（sim-3 の失敗の理由）
export type Issue =
  | 'ip.unset'
  | 'segment.unset'
  | 'ip.out_of_segment'
  | 'segment.overlap'
  | 'segment.too_small'
  | 'gateway.mismatch'
  | 'gateway.unset';

// 同じ機器に複数の不備があるとき、先に並べたものを出す
const ISSUE_ORDER: Issue[] = [
  'ip.unset',
  'segment.unset',
  'ip.out_of_segment',
  'segment.overlap',
  'segment.too_small',
  'gateway.mismatch',
  'gateway.unset',
];

export interface IssueDetail {
  reason: Issue;
  // 対象のIPアドレス、セグメント（例: 192.168.1.0/24）、ゲートウェイ
  ip?: string;
  segment?: string;
  gateway?: string;
}

export interface AddressLayer {
  // アドレスを補完した保存の構成（無線の仮想の配線と DHCP の割り当ての前。配線と口の設定は保存のまま）
  readonly completed: Network;
  // 実効の構成: 補完した機器に、配線の層の無線の仮想の配線とアクセスポイントの口の設定を重ねたもの
  readonly net: Network;
  // 設計の不備（機器ごとに1つ）
  readonly issues: Readonly<Record<string, IssueDetail>>;
}

const label = (cfg: SegmentConfig): string => `${cfg.network}/${cfg.prefix}`;

const complete = (input: Network, data: EngineData): { net: Network; issues: Record<string, IssueDetail> } => {
  const segs = segmentsOf(input, data);
  const byUid = new Map(input.nodes.map((n) => [n.uid, n]));
  const cat = (n: NetNode) => deviceCategory(n.device);
  const fixed = (n: NetNode) => n.configLocked && n.interfaces.length > 0;
  const ifaceOf = (n: NetNode, port: number): Iface | undefined => n.interfaces.find((i) => i.port === port);

  // セグメントごとの設定と、端点からセグメントを引く表
  const cfgOf = new Map<string, SegmentConfig>();
  const segOf = new Map<string, Segment>();
  for (const seg of segs) {
    const cfg = segmentConfigOf(seg, byUid, input.segments);
    if (cfg) cfgOf.set(seg.key, cfg);
    for (const m of seg.members) segOf.set(epKey(m.node, m.port), seg);
  }

  const issues: Record<string, IssueDetail> = {};
  const flag = (uid: string, d: IssueDetail) => {
    const cur = issues[uid];
    if (!cur || ISSUE_ORDER.indexOf(d.reason) < ISSUE_ORDER.indexOf(cur.reason)) issues[uid] = d;
  };

  // 設定のあるセグメント同士で、アドレスの範囲が重なるものを両方の機器に出す
  const ranges = segs
    .filter((s) => cfgOf.has(s.key))
    .map((seg) => {
      const cfg = cfgOf.get(seg.key)!;
      const start = ipToInt(cfg.network);
      return { seg, cfg, start, end: start + 2 ** (32 - cfg.prefix) };
    });
  for (let i = 0; i < ranges.length; i++) {
    for (let j = i + 1; j < ranges.length; j++) {
      const a = ranges[i];
      const b = ranges[j];
      if (a.start < b.end && b.start < a.end) {
        for (const r of [a, b]) for (const m of r.seg.members) flag(m.node, { reason: 'segment.overlap', segment: label(r.cfg) });
      }
    }
  }

  // セグメントの中の機器ごとの不備（IPアドレスの未設定、範囲外、セグメントの大きさ）
  for (const seg of segs) {
    const cfg = cfgOf.get(seg.key);
    for (const m of seg.members) {
      const node = byUid.get(m.node)!;
      const iface = ifaceOf(node, m.port);
      if (!iface) {
        flag(node.uid, { reason: 'ip.unset' });
        continue;
      }
      // 自動（DHCP）の口のアドレスは、割り当てで決まる
      if (iface.dhcp === true) continue;
      if (!cfg) {
        flag(node.uid, { reason: 'segment.unset', ip: iface.ip });
        continue;
      }
      if (!inSubnet(iface.ip, cfg.network, cfg.prefix)) {
        flag(node.uid, { reason: 'ip.out_of_segment', ip: iface.ip, segment: label(cfg) });
      }
      if (seg.members.length > hostCapacity(cfg.prefix)) {
        flag(node.uid, { reason: 'segment.too_small', segment: label(cfg) });
      }
    }
  }

  // PC・サーバーは、配線の有無にかかわらず IPアドレスが必要。
  // 経路を持つ機器と、口0が中継だけの機器（L2 スイッチ・回線終端・アクセスポイント）は、IPアドレスを持たなくてよい
  for (const n of input.nodes) {
    const c = cat(n);
    if (!isRoutingCategory(c) && !isRelayPort(c, 0) && n.interfaces.length === 0) flag(n.uid, { reason: 'ip.unset' });
  }

  // ホストのデフォルトゲートウェイは、同じセグメントにあるルーターのポートのアドレス（最も小さいもの）
  const routerIpsOf = (seg: Segment): string[] =>
    seg.members
      .filter((m) => isRoutingCategory(cat(byUid.get(m.node)!)))
      .map((m) => ifaceOf(byUid.get(m.node)!, m.port)?.ip)
      .filter((ip): ip is string => !!ip)
      .sort((a, b) => ipToInt(a) - ipToInt(b));

  const gatewayOf = new Map<string, string | null>();
  for (const n of input.nodes) {
    const c = cat(n);
    if (isL2Category(c) || isRoutingCategory(c)) continue;
    const iface = n.interfaces[0];
    const seg = iface ? segOf.get(epKey(n.uid, iface.port)) : undefined;
    const gw = seg ? (routerIpsOf(seg)[0] ?? null) : null;
    if (fixed(n)) {
      // 案件で固定されたゲートウェイは変えられない。ルーターのアドレスと合わなければ不備
      gatewayOf.set(n.uid, n.gateway);
      if (seg && gw !== null && n.gateway !== gw) flag(n.uid, { reason: 'gateway.mismatch', gateway: n.gateway ?? '', ip: gw });
    } else {
      gatewayOf.set(n.uid, gw);
      if (seg && gw === null && segs.length > 1) flag(n.uid, { reason: 'gateway.unset' });
    }
  }

  const nodes: NetNode[] = input.nodes.map((n) => {
    const c = cat(n);
    if (isL2Category(c)) return { ...n, interfaces: [], gateway: null, routes: [] };
    // 中継だけの口（スイッチ付きルーターの2つ目以降の LAN 口）はアドレスを持たない
    // ポートのプレフィックス長は、そのセグメントの設定に従う
    const interfaces = n.interfaces
      .filter((i) => !isRelayPort(c, i.port))
      .map((i) => {
        const seg = segOf.get(epKey(n.uid, i.port));
        const cfg = seg ? cfgOf.get(seg.key) : undefined;
        return cfg ? { ...i, prefix: cfg.prefix } : { ...i };
      });
    // 案件で設定を固定した機器（仮想の ISP など）の既定のゲートウェイは、ルーターでも残す
    if (isRoutingCategory(c)) return { ...n, interfaces, gateway: fixed(n) ? n.gateway : null, routes: n.routes };
    return { ...n, interfaces, gateway: gatewayOf.get(n.uid) ?? null, routes: n.routes };
  });

  return { net: { nodes, links: input.links, segments: input.segments }, issues };
};

export const stageAddressing = (input: Network, world: EngineData, links: LinkLayer): AddressLayer => {
  // セグメントは保存の配線から求める（無線の仮想の配線は入れない）
  const { net: completed, issues } = complete(input, world);
  // 無線の仮想の配線と口の設定は、配線の層の構成から取り、補完を入れた機器に重ねる
  const portsOf = new Map(links.net.nodes.map((n) => [n.uid, n.ports]));
  const net: Network = { ...completed, nodes: completed.nodes.map((n) => (portsOf.get(n.uid) === n.ports ? n : { ...n, ports: portsOf.get(n.uid) ?? n.ports })), links: links.net.links };
  return { completed, net, issues };
};
