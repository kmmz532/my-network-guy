// アドレスの層: 実効の口のアドレス・端末のゲートウェイの補完・L2 の機器と中継だけの口のアドレスの除去・DHCP の割り当て・VRRP の持ち主・設計の不備（issues）。
// セグメントの設定と機器の設定（IPアドレス・ルート）から求める。IPアドレスの未設定や設定の不備は、機器ごとの issues として返す。
// 層の順序: 配線の層・L2 の層の後に置く。L2 の層は、口にアドレスが残るか（中継だけの口ではないか）で口の扱いを変えるが、
// その規則（isRelayPort）は機器の種類と口の番号だけで決まるため、L2 の層は保存の構成に同じ規則を当てて求め、この層の結果を読まない
import { inSubnet, ipToInt } from '../../ip';
import { deliver } from '../forward';
import { stageRouting } from './routing';
import { assignDhcp, type DhcpResult } from '../../dhcp';
import { electVrrpMaster, type VrrpMember } from '../../vrrp';
import { isL2Category, isRelayPort, isRoutingCategory } from '../../category';
import { epKey, hostCapacity, planFor } from '../../segments';
import type { Iface, NetNode, Network, NetworkPlan } from '../../types';
import { deviceCategory } from '../../../registry/query';
import { can } from '../../capabilities';
import type { L2Layer, PlanDomain } from './l2';
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
  // 実効の構成: 補完した機器に、配線の層の無線の仮想の配線とアクセスポイントの口の設定を重ね、DHCP の割り当てを入れたもの
  readonly net: Network;
  // 実効の構成の機器（net.nodes の uid 引き）
  nodeOf(uid: string): NetNode | undefined;
  // 設計の不備（機器ごとに1つ）
  readonly issues: Readonly<Record<string, IssueDetail>>;
  // DHCP の割り当ての結果（自動の口がなければ空）
  readonly dhcp: DhcpResult;
  // 同じブロードキャストドメインで、同じ VRID のグループを持つインターフェース（自分を含む）
  vrrpMembers(uid: string, port: number, vrid: number): VrrpMember[];
  // この口が、仮想の IP アドレス ip のマスター（持ち主）か
  vrrpOwns(uid: string, port: number, ip: string): boolean;
}

const label = (cfg: NetworkPlan): string => `${cfg.network}/${cfg.prefix}`;

const complete = (input: Network, segs: readonly PlanDomain[]): { net: Network; issues: Record<string, IssueDetail> } => {
  const byUid = new Map(input.nodes.map((n) => [n.uid, n]));
  const cat = (n: NetNode) => deviceCategory(n.device);
  const fixed = (n: NetNode) => n.configLocked && n.interfaces.length > 0;
  const ifaceOf = (n: NetNode, port: number): Iface | undefined => n.interfaces.find((i) => i.port === port);

  // L2 ドメインごとの計画と、端点から L2 ドメインを引く表（無線の端末は含めない。端点が複数のドメインに入るときは鍵の小さい方）
  const cfgOf = new Map<string, NetworkPlan>();
  const segOf = new Map<string, PlanDomain>();
  for (const seg of segs) {
    const cfg = planFor(seg, byUid, input.plans);
    if (cfg) cfgOf.set(seg.key, cfg);
    for (const m of seg.members) if (!segOf.has(epKey(m.node, m.port))) segOf.set(epKey(m.node, m.port), seg);
  }

  const issues: Record<string, IssueDetail> = {};
  const flag = (uid: string, d: IssueDetail) => {
    const cur = issues[uid];
    if (!cur || ISSUE_ORDER.indexOf(d.reason) < ISSUE_ORDER.indexOf(cur.reason)) issues[uid] = d;
  };

  // ルーターでつながった L2 ドメインの組（ルーターが両方のドメインに口を持てば、同じ組にまとめる）
  const group = new Map<string, string>();
  const root = (k: string): string => {
    let r = k;
    while (group.get(r) !== undefined && group.get(r) !== r) r = group.get(r)!;
    return r;
  };
  const domainsOfRouter = new Map<string, string[]>();
  for (const seg of segs) {
    group.set(seg.key, seg.key);
    for (const m of seg.members) {
      const n = byUid.get(m.node);
      if (!n || !can(n.device, 'routing')) continue;
      domainsOfRouter.set(n.uid, [...(domainsOfRouter.get(n.uid) ?? []), seg.key]);
    }
  }
  for (const keys of domainsOfRouter.values()) for (const k of keys.slice(1)) group.set(root(k), root(keys[0]));

  // 設定のあるセグメント同士で、アドレスの範囲が重なるものを両方の機器に出す。
  // 経路として衝突しうるのはルーターでつながったドメインの間だけのため、つながっていないドメインの重なりは不備にしない（VLAN で分けた同じサブネットなど）
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
      if (a.start < b.end && b.start < a.end && root(a.seg.key) === root(b.seg.key)) {
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
  const routerIpsOf = (seg: PlanDomain): string[] =>
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

  return { net: { nodes, links: input.links, plans: input.plans }, issues };
};

// VRRP の持ち主。同じブロードキャストドメインで同じ VRID を持つ、動いているインターフェースの中から選ぶ
const vrrpOf = (nodes: readonly NetNode[], links: LinkLayer, l2: L2Layer): Pick<AddressLayer, 'vrrpMembers' | 'vrrpOwns'> => {
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const ifaceAt = (uid: string, port: number): Iface | undefined => byUid.get(uid)?.interfaces.find((i) => i.port === port);
  const vrrpMembers = (uid: string, port: number, vrid: number): VrrpMember[] => {
    const self = ifaceAt(uid, port);
    if (!self?.vrrp?.some((g) => g.vrid === vrid)) return [];
    const eps = [{ node: uid, port }, ...l2.domainOf({ node: uid, port }).members];
    const seen = new Set<string>();
    const members: VrrpMember[] = [];
    for (const ep of eps) {
      if (seen.has(ep.node)) continue;
      const iface = ifaceAt(ep.node, ep.port);
      const group = iface?.vrrp?.find((g) => g.vrid === vrid);
      if (!iface || !group) continue;
      seen.add(ep.node);
      const peer = l2.linkAt(ep)?.peer;
      // 追跡するインターフェースは、口の停止・配線なし・相手の口の停止で止まっている
      const down = (i: Iface) => {
        const linked = l2.linkAt({ node: ep.node, port: i.port });
        return links.isShut(ep.node, i.port) || !linked || links.isShut(linked.peer.node, linked.peer.port);
      };
      const owner = byUid.get(ep.node)!;
      members.push({
        uid: ep.node,
        realIp: iface.ip,
        group,
        downTracked: (group.track ?? []).filter((t) => owner.interfaces.some((i) => i.id === t.iface && down(i))).map((t) => t.iface),
        up: !links.isShut(ep.node, ep.port) && peer !== undefined,
      });
    }
    return members;
  };
  const vrrpOwns = (uid: string, port: number, ip: string): boolean => {
    const group = ifaceAt(uid, port)?.vrrp?.find((g) => g.ip === ip);
    // 動いているものがなければ、持ち主はいない（全員が止まっている）
    return group !== undefined && electVrrpMaster(vrrpMembers(uid, port, group.vrid)) === uid;
  };
  return { vrrpMembers, vrrpOwns };
};

const nodeIndex = (net: Network): AddressLayer['nodeOf'] => {
  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  return (uid) => byUid.get(uid);
};

const NO_DHCP: DhcpResult = { leases: [], failed: [], multiple: [] };

// 割り当てを機器に入れる。受け取れない口は 169.254.x.y/16（機器の連番から決める）。保存してある前回のアドレスは書き換えない
const withLeases = (net: Network, dhcp: DhcpResult): Network => ({
  ...net,
  nodes: net.nodes.map((n) => {
    const mine = dhcp.leases.filter((l) => l.uid === n.uid);
    const failed = dhcp.failed.filter((f) => f.uid === n.uid);
    if (mine.length === 0 && failed.length === 0) return n;
    return {
      ...n,
      interfaces: n.interfaces.map((i) => {
        const l = i.dhcp === true ? mine.find((x) => x.port === i.port) : undefined;
        if (i.dhcp === true && l === undefined && failed.some((f) => f.port === i.port)) return { ...i, ip: `169.254.${((n.macSerial ?? 0) >> 8) & 255}.${((n.macSerial ?? 0) & 255) || 1}`, prefix: 16 };
        return l ? { ...i, ip: l.ip, prefix: l.prefix } : i;
      }),
      // 自動の間は、手で入れたゲートウェイとネームサーバーは使わない（プールの値で置き換える）
      gateway: mine.find((l) => l.gateway)?.gateway ?? null,
      nameServer: mine.find((l) => l.dns)?.dns,
    };
  }),
});

export const stageAddressing = (input: Network, links: LinkLayer, l2: L2Layer): AddressLayer => {
  // 計画は L2 ドメインで引く。無線の端末は計画の不備とゲートウェイの補完の対象にしない
  const { net: completed, issues } = complete(input, l2.planDomains);
  // 無線の仮想の配線と口の設定は、配線の層の構成から取り、補完を入れた機器に重ねる
  const portsOf = new Map(links.net.nodes.map((n) => [n.uid, n.ports]));
  const before: Network = { ...completed, nodes: completed.nodes.map((n) => (portsOf.get(n.uid) === n.ports ? n : { ...n, ports: portsOf.get(n.uid) ?? n.ports })), links: links.net.links };
  const unassigned: AddressLayer = { completed, net: before, issues, dhcp: NO_DHCP, nodeOf: nodeIndex(before), ...vrrpOf(before.nodes, links, l2) };
  if (!before.nodes.some((n) => n.interfaces.some((i) => i.dhcp === true))) return unassigned;

  // DHCP の割り当ては、割り当て前の構成で求める。同じドメインは L2 の層から引く。
  // リレーの到達は、割り当て前の構成で経路を仮に求め、リレーのルーターからサーバーまでたどる（この層の中だけで使い、外へ出さない）
  const routed = { links, l2, addressing: unassigned, routing: stageRouting(unassigned.net, l2) };
  const nodeOf = new Map(before.nodes.map((n) => [n.uid, n]));
  const dhcp = assignDhcp(before.nodes, {
    domainOf: (uid, port) => l2.domainOf({ node: uid, port }).members,
    // リレーのルーターが、サーバー側の口（サーバーのアドレスと同じサブネットの口。なければリレーの口）から届くか
    reaches: (routerUid, routerIp, serverUid, serverIp) => {
      const toward = nodeOf.get(routerUid)?.interfaces.find((i) => i.ip !== '' && inSubnet(serverIp, i.ip, i.prefix));
      return deliver(routed, routerUid, serverUid, { kind: 'ping' }, false, toward?.ip ?? routerIp, serverIp).ok;
    },
  });
  const net = withLeases(before, dhcp);
  return { completed, net, issues, dhcp, nodeOf: nodeIndex(net), ...vrrpOf(net.nodes, links, l2) };
};
