// アドレスの計画を L2 ドメインの単位にする前の、セグメント（配線とスイッチでつながった機器の集まり）の規則。セーブの移行でだけ使う。
// セグメントは代表端点（セグメント内で最も小さい機器の uid と口）の鍵 "uid:port" で設定を持っていた
import { inSubnet } from '../network/engine';
import { isFabricPort, isL3FabricPort, isRelayPort, isSwitchedRouterCategory, ROUTER_SWITCH_LAN_HOST_PORT, sviPortOf } from '../network/category';
import { epKey, networkAddress, planFor } from '../network/segments';
import { analyze } from '../network/engine/analyze';
import type { EngineData, Endpoint, NetLink, NetNode, NetworkPlan } from '../network/types';
import { deviceCategory } from '../registry/query';

interface Segment {
  key: string;
  // セグメントに属する機器の端点（スイッチは含めない。ルーターの口は含む）。uid・口の昇順
  members: Endpoint[];
}

type LegacyNet = { nodes: NetNode[]; links: NetLink[] };

const byEndpoint = (a: Endpoint, b: Endpoint): number => (a.node < b.node ? -1 : a.node > b.node ? 1 : a.port - b.port);

// 配線とスイッチでつながった端点を、セグメントにまとめる。機器のない組（スイッチだけ）はセグメントにしない。
// VLAN で分けるのは L3 スイッチの口だけ（L2 スイッチの VLAN では分けない）
export const legacySegmentsOf = (net: LegacyNet): Segment[] => {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    if (!parent.has(k)) parent.set(k, k);
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  const categoryOf = new Map(net.nodes.map((n) => [n.uid, deviceCategory(n.device)]));
  const cat = (uid: string) => categoryOf.get(uid) ?? '';
  const nodeOf = new Map(net.nodes.map((n) => [n.uid, n]));
  // 口が機器の内部のスイッチにつながるか（L3スイッチの access・trunk の口を含む・N138）
  const cfgOf = (uid: string, port: number) => nodeOf.get(uid)?.ports?.find((p) => p.port === port);
  const hasIpOf = (uid: string, port: number): boolean => (nodeOf.get(uid)?.interfaces ?? []).some((i) => i.kind === 'port' && i.port === port);
  const l3Fabric = (uid: string, port: number): boolean => isL3FabricPort(cat(uid), port, cfgOf(uid, port), hasIpOf(uid, port));
  const fabricOf = (uid: string, port: number): boolean => isFabricPort(cat(uid), port) || l3Fabric(uid, port);
  // L3スイッチの access の口は VLAN ごとにまとめる（SVI と同じ VLAN のセグメントになる）。L2 と trunk は機器ごと
  const fabricKey = (uid: string, port: number): string => {
    const cfg = cfgOf(uid, port);
    return cat(uid) === 'l3_switch' && l3Fabric(uid, port) && (cfg === undefined || cfg.mode === 'access') ? `${uid}#${cfg?.vlan ?? 1}` : uid;
  };

  const endpoints = new Map<string, Endpoint>();
  for (const link of net.links) {
    const a = epKey(link.a.node, link.a.port);
    const b = epKey(link.b.node, link.b.port);
    endpoints.set(a, link.a);
    endpoints.set(b, link.b);
    union(a, b);
  }
  // スイッチ付きルーターは、LAN の口につながっていれば代表の LAN 口もセグメントに含める（アドレスを持つ口）
  for (const ep of [...endpoints.values()]) {
    if (!isFabricPort(cat(ep.node), ep.port) || !isSwitchedRouterCategory(cat(ep.node))) continue;
    const host = { node: ep.node, port: ROUTER_SWITCH_LAN_HOST_PORT };
    endpoints.set(epKey(host.node, host.port), host);
  }
  // 機器の内部のスイッチにつながる口は、同じ機器のものすべてを同じセグメントにする
  const fabricFirst = new Map<string, string>();
  for (const ep of endpoints.values()) {
    if (!fabricOf(ep.node, ep.port)) continue;
    const k = epKey(ep.node, ep.port);
    const fk = fabricKey(ep.node, ep.port);
    const first = fabricFirst.get(fk);
    if (first) union(k, first);
    else fabricFirst.set(fk, k);
  }
  // SVI（VLAN のインターフェース・N138）は、同じ VLAN の口のセグメントに入る
  for (const node of net.nodes) {
    for (const i of node.interfaces) {
      if (i.kind !== 'svi' || i.vlan === undefined) continue;
      const k = epKey(node.uid, sviPortOf(i.vlan));
      endpoints.set(k, { node: node.uid, port: sviPortOf(i.vlan) });
      const first = fabricFirst.get(`${node.uid}#${i.vlan}`);
      if (first) union(k, first);
      else fabricFirst.set(`${node.uid}#${i.vlan}`, k);
    }
  }

  const groups = new Map<string, Endpoint[]>();
  for (const ep of endpoints.values()) {
    const root = find(epKey(ep.node, ep.port));
    groups.set(root, [...(groups.get(root) ?? []), ep]);
  }
  const segments: Segment[] = [];
  for (const eps of groups.values()) {
    const members = eps.filter((ep) => !isRelayPort(cat(ep.node), ep.port) && !l3Fabric(ep.node, ep.port)).sort(byEndpoint);
    if (members.length === 0) continue;
    segments.push({ key: epKey(members[0].node, members[0].port), members });
  }
  return segments.sort((a, b) => (a.key < b.key ? -1 : 1));
};



// 設定のないセグメントに、IPアドレスのある機器から設定を作る（そのセグメントで最も小さい機器のアドレスのネットワーク）。保存された設定は残す
export const legacyFillSegments = (net: LegacyNet, segments: Record<string, NetworkPlan> = {}): Record<string, NetworkPlan> => {
  const nodes = new Map(net.nodes.map((n) => [n.uid, n]));
  const out: Record<string, NetworkPlan> = { ...segments };
  for (const seg of legacySegmentsOf(net)) {
    if (planFor(seg, nodes, out)) continue;
    for (const m of seg.members) {
      const iface = nodes.get(m.node)?.interfaces.find((i) => i.port === m.port);
      if (iface) {
        out[seg.key] = { network: networkAddress(iface.ip, iface.prefix), prefix: iface.prefix };
        break;
      }
    }
  }
  return out;
};

// セグメントの鍵の設定を、L2 ドメインの鍵の計画に付け替える（移行の時点の構成で L2 ドメインを求める）。
// セグメントが1つの L2 ドメインに当たれば、そのドメインへ写す。VLAN で複数のドメインに分かれていれば、
// 計画の範囲にアドレスのある口を含むドメインにだけ写す。どのドメインにも当てはまらない設定は捨てる
export const segmentsToPlans = (net: LegacyNet, segments: Record<string, NetworkPlan>, data: EngineData): Record<string, NetworkPlan> => {
  if (Object.keys(segments).length === 0) return {};
  const segs = legacySegmentsOf(net);
  const domains = analyze({ nodes: net.nodes, links: net.links }, data).l2.planDomains;
  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  const out: Record<string, NetworkPlan> = {};
  for (const [key, plan] of Object.entries(segments).sort(([a], [b]) => (a < b ? -1 : 1))) {
    const seg = segs.find((s) => s.key === key);
    if (!seg) continue;
    const inSeg = (m: Endpoint) => seg.members.some((x) => x.node === m.node && x.port === m.port);
    const hits = domains.filter((d) => d.members.some(inSeg));
    const addressed = (m: Endpoint): boolean => {
      const iface = byUid.get(m.node)?.interfaces.find((i) => i.port === m.port);
      return iface !== undefined && inSubnet(iface.ip, plan.network, plan.prefix);
    };
    const targets = hits.length === 1 ? hits : hits.filter((d) => d.members.some((m) => inSeg(m) && addressed(m)));
    for (const d of targets) if (out[d.key] === undefined) out[d.key] = plan;
  }
  return out;
};
