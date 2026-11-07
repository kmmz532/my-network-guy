// IPアドレスの自動割り当て（純粋関数）。配線・セグメントの設定の後に呼び、PC・サーバーのIPアドレスが未設定のポートへ、
// そのセグメントの空いているアドレスを .10 から順に振る（使えなければ .1 から）。ゲートウェイが未設定なら、同じセグメントのルーターのアドレスにする。
// ネットワークが決まっていないセグメントには、ルーターのアドレスの /24（なければ、ほかと重ならない 192.168.N.0/24）を既定として決め、
// ルーターのポートが未設定なら .1 を振る（ホストのゲートウェイも .1 になる）。
// 設定がオフのとき、または案件が manualIp のときは何もしない。
import { inSubnet, ipToInt } from '../network/engine';
import { intToIp, networkAddress, routerAddressesOn, segmentConfigOf, segmentsOf } from '../network/segments';
import type { NetNode, SegmentConfig } from '../network/types';
import { focusedOf, netOf, withNet, type Core, type Env, type NetTarget } from './project';
import { CATEGORY, isPcCategory } from '../data/categories';

// ルーターと、ファイアウォール（経路の設定を持つ機器）
const isRoutingFirewall = (category: string): boolean => category === CATEGORY.router || category === CATEGORY.firewall;

// 振り始めのアドレス（ホストの末尾）。使えなければ .1 から探す
const FIRST_HOST = 10;
// 既定のネットワークを選ぶ第1オクテットの後ろ（192.168.N.0/24 の N を 1 から探す）
const DEFAULT_PREFIX = 24;

type Segment = ReturnType<typeof segmentsOf>[number];

// 詳しくで選んだ、まだ設定のないセグメントのネットワーク（ストアの planned。なければ undefined）
export const autoAssign = (
  core: Core,
  env: Env,
  target: NetTarget,
  enabled: boolean,
  planned: (seg: Segment) => SegmentConfig | undefined = () => undefined,
): Core => {
  if (!enabled) return core;
  if (target === 'focus' && focusedOf(core)?.contract.manualIp) return core;
  // 編集できない対象（自社オフィスが案件に使われている、設計中でない）は、netOf が理由を返すので何もしない
  const net = netOf(core, target);
  if (typeof net === 'string') return core;

  // 対象のネットワーク全体の使用中のアドレス（セグメントをまたいでも重ならないようにする）
  const used = new Set<number>();
  for (const n of net.nodes) for (const i of n.interfaces) used.add(ipToInt(i.ip));

  let nodes: NetNode[] = net.nodes;
  let segments: Record<string, SegmentConfig> = net.segments;
  let changed = false;
  const nodeMap = (): Map<string, NetNode> => new Map(nodes.map((n) => [n.uid, n]));
  const categoryOf = (uid: string): string => {
    const node = nodes.find((n) => n.uid === uid);
    return node ? env.engine.categoryOf(node.device) : '';
  };

  // 既に使われているネットワーク（設定済みのセグメント・機器のアドレスのネットワーク）
  const networksInUse = (): SegmentConfig[] => {
    const cfgs: SegmentConfig[] = [];
    for (const seg of segmentsOf({ nodes, links: net.links }, env.engine)) {
      const cfg = segmentConfigOf(seg, nodeMap(), segments);
      if (cfg) cfgs.push(cfg);
    }
    return [...cfgs, ...Object.values(segments)];
  };
  // ほかと重ならない 192.168.N.0/24 を、N の小さい順に選ぶ
  const pickDefaultNetwork = (): SegmentConfig | undefined => {
    const inUse = networksInUse();
    for (let n = 1; n <= 255; n++) {
      const network = `192.168.${n}.0`;
      const clash = inUse.some((c) => inSubnet(network, c.network, c.prefix) || inSubnet(c.network, network, DEFAULT_PREFIX));
      if (!clash) return { network, prefix: DEFAULT_PREFIX };
    }
    return undefined;
  };
  // セグメントにIPアドレスのあるポート（ルーターなど）があれば、その /24 をセグメントのネットワークにする
  const ifaceConfigOf = (seg: ReturnType<typeof segmentsOf>[number]): SegmentConfig | undefined => {
    for (const m of seg.members) {
      const iface = nodeMap().get(m.node)?.interfaces.find((i) => i.port === m.port);
      if (iface) return { network: networkAddress(iface.ip, DEFAULT_PREFIX), prefix: DEFAULT_PREFIX };
    }
    return undefined;
  };

  for (const seg of segmentsOf(net, env.engine)) {
    const hostsUnset = seg.members.some((m) => {
      const node = nodeMap().get(m.node);
      if (!node || node.configLocked) return false;
      const category = env.engine.categoryOf(node.device);
      return (isPcCategory(category) || category === CATEGORY.server) && !node.interfaces.some((i) => i.port === m.port);
    });
    let cfg = segmentConfigOf(seg, nodeMap(), segments) ?? ifaceConfigOf(seg);
    let defaulted = false;
    if (!cfg) {
      // ネットワークが決まっていないセグメントは、振る相手（IPのない PC・サーバー）があるときだけ既定を決める
      if (!hostsUnset) continue;
      cfg = planned(seg) ?? pickDefaultNetwork();
      if (!cfg) continue;
      segments = { ...segments, [seg.key]: cfg };
      changed = true;
      defaulted = true;
    }
    const base = ipToInt(cfg.network);
    const size = 2 ** (32 - cfg.prefix);
    // 空いているホストの番号（from から探し、なければ見つからない）
    const pickFree = (from: number): number | undefined => {
      for (let h = from; h <= size - 2; h++) if (!used.has(base + h)) return h;
      return undefined;
    };
    const assign = (m: { node: string; port: number }, h: number) => {
      used.add(base + h);
      const ip = intToIp(base + h);
      nodes = nodes.map((n) =>
        n.uid === m.node ? { ...n, interfaces: [...n.interfaces, { port: m.port, ip, prefix: cfg.prefix }] } : n,
      );
      changed = true;
    };

    // 既定で決めたセグメントでは、ルーターのポートに .1 を振る（ホストのゲートウェイがこれになる）
    if (defaulted) {
      for (const m of seg.members) {
        const node = nodeMap().get(m.node);
        if (!node || node.configLocked || !isRoutingFirewall(categoryOf(m.node))) continue;
        if (node.interfaces.some((i) => i.port === m.port)) continue;
        const h = pickFree(1);
        if (h !== undefined) assign(m, h);
      }
    }

    for (const m of seg.members) {
      const node = nodeMap().get(m.node);
      if (!node || node.configLocked) continue;
      const category = env.engine.categoryOf(node.device);
      if (!isPcCategory(category) && category !== CATEGORY.server) continue;
      if (node.interfaces.some((i) => i.port === m.port)) continue;

      const h = pickFree(FIRST_HOST) ?? pickFree(1);
      if (h === undefined) continue;
      const before = nodes;
      assign(m, h);

      // ゲートウェイが未設定で、同じセグメントにルーターのアドレスがあれば、それにする
      const gateway =
        node.gateway === null
          ? (routerAddressesOn({ nodes: before, links: net.links }, env.engine, m.node, m.port).find((r) =>
              inSubnet(r, cfg.network, cfg.prefix),
            ) ?? null)
          : node.gateway;
      nodes = nodes.map((n) => (n.uid === node.uid ? { ...n, gateway } : n));
    }
  }

  if (!changed) return core;
  return withNet(core, target, { ...net, nodes, segments });
};
