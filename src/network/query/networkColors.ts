import { inSubnet, ipToInt } from '../engine';
import { epKey, segmentConfigOf, type Segment } from '../segments';
import { isL2Category, isRelayPort } from '../category';
import type { SegmentConfig } from '../types';
import { deviceCategory } from '../../registry/query';
import type { NetworkState } from '../engine/state';
import type { NetworkColors } from '../netColor';

// 設定されたセグメントのネットワークごとに色を決め、ケーブルがどのネットワークを表すかを求める
export const networkColors = (state: NetworkState): NetworkColors => {
  const net = state.net;
  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  const segs = state.l2.segments;
  const cfgOf = new Map<string, SegmentConfig>();
  const segOf = new Map<string, Segment>();
  const vlanOfNetwork = new Map<string, number>();
  for (const seg of segs) {
    const cfg = segmentConfigOf(seg, byUid, net.segments);
    if (cfg) cfgOf.set(seg.key, cfg);
    if (cfg) {
      const vlan = seg.members
        .map((m) => byUid.get(m.node)?.ports.find((p) => p.port === m.port))
        .find((p) => p?.mode === 'access')?.vlan;
      if (vlan !== undefined) vlanOfNetwork.set(cfg.network, vlan);
    }
    for (const m of seg.members) segOf.set(epKey(m.node, m.port), seg);
  }

  const networks = [...new Set([...cfgOf.values()].map((c) => c.network))].sort((a, b) => ipToInt(a) - ipToInt(b));
  const index = new Map(networks.map((n, i) => [n, i]));
  const networkPrefix = new Map([...cfgOf.values()].map((cfg) => [cfg.network, cfg.prefix]));

  const linkNetwork = new Map<string, string | null>();
  const linkNetworks = new Map<string, string[]>();
  for (const link of net.links) {
    // スイッチ側の端は members に入らないため、両端のうち設定のあるセグメントを使う（a を優先する）
    const cfg = [link.a, link.b]
      .map((ep) => segOf.get(epKey(ep.node, ep.port)))
      .map((seg) => (seg ? cfgOf.get(seg.key) : undefined))
      .find((c) => c !== undefined);
    if (!cfg) {
      linkNetwork.set(link.uid, null);
      linkNetworks.set(link.uid, []);
      continue;
    }
    // 両端の機器（スイッチを除く）のアドレスが、このネットワークに入っていること
    const agrees = [link.a, link.b].every((ep) => {
      const node = byUid.get(ep.node);
      if (!node || isL2Category(deviceCategory(node.device)) || isRelayPort(deviceCategory(node.device), ep.port)) return true;
      const iface = node.interfaces.find((i) => i.port === ep.port);
      return iface !== undefined && inSubnet(iface.ip, cfg.network, cfg.prefix);
    });
    linkNetwork.set(link.uid, agrees ? cfg.network : null);
    if (!agrees) {
      linkNetworks.set(link.uid, []);
      continue;
    }
    const endpoints = [link.a, link.b];
    const carries = (endpoint: (typeof link.a), vlan: number): boolean => {
      const port = byUid.get(endpoint.node)?.ports.find((p) => p.port === endpoint.port);
      if (port?.mode === 'trunk') return port.allowed === undefined || port.allowed.includes(vlan);
      return (port?.vlan ?? 1) === vlan;
    };
    const trunk = endpoints.some((endpoint) => byUid.get(endpoint.node)?.ports.find((p) => p.port === endpoint.port)?.mode === 'trunk');
    const carried = trunk
      ? networks.filter((network) => {
          const vlan = vlanOfNetwork.get(network);
          return vlan === undefined || endpoints.every((endpoint) => carries(endpoint, vlan));
        })
      : [cfg.network];
    linkNetworks.set(link.uid, carried.length > 0 ? carried : [cfg.network]);
  }
  return { index, linkNetwork, linkNetworks, networkPrefix };
};
