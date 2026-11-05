// IPアドレスの自動割り当て（純粋関数）。配線・セグメントの設定の後に呼び、PC・サーバーのIPアドレスが未設定のポートへ、
// そのセグメントの空いているアドレスを .10 から順に振る（使えなければ .1 から）。ゲートウェイが未設定なら、同じセグメントのルーターのアドレスにする。
// 設定がオフのとき、または案件が manualIp のときは何もしない。ネットワークが決まっていないセグメントも何もしない。
import { inSubnet, ipToInt } from '../network/engine';
import { routerAddressesOn, segmentConfigOf, segmentsOf, intToIp } from '../network/segments';
import type { NetNode } from '../network/types';
import { focusedOf, netOf, withNet, type Core, type Env, type NetTarget } from './project';

// 振り始めのアドレス（ホストの末尾）。使えなければ .1 から探す
const FIRST_HOST = 10;

export const autoAssign = (core: Core, env: Env, target: NetTarget, enabled: boolean): Core => {
  if (!enabled) return core;
  if (target === 'focus' && focusedOf(core)?.contract.manualIp) return core;
  // 編集できない対象（自社オフィスが案件に使われている、設計中でない）は、netOf が理由を返すので何もしない
  const net = netOf(core, target);
  if (typeof net === 'string') return core;

  // 対象のネットワーク全体の使用中のアドレス（セグメントをまたいでも重ならないようにする）
  const used = new Set<number>();
  for (const n of net.nodes) for (const i of n.interfaces) used.add(ipToInt(i.ip));

  let nodes: NetNode[] = net.nodes;
  let changed = false;
  const nodeMap = (): Map<string, NetNode> => new Map(nodes.map((n) => [n.uid, n]));

  for (const seg of segmentsOf(net, env.engine)) {
    const cfg = segmentConfigOf(seg, nodeMap(), net.segments);
    if (!cfg) continue;
    const base = ipToInt(cfg.network);
    const size = 2 ** (32 - cfg.prefix);
    // 空いているホストの番号（from から探し、なければ見つからない）
    const pickFree = (from: number): number | undefined => {
      for (let h = from; h <= size - 2; h++) if (!used.has(base + h)) return h;
      return undefined;
    };

    for (const m of seg.members) {
      const node = nodeMap().get(m.node);
      if (!node || node.configLocked) continue;
      const category = env.engine.categoryOf(node.device);
      if (category !== 'pc' && category !== 'server') continue;
      if (node.interfaces.some((i) => i.port === m.port)) continue;

      const h = pickFree(FIRST_HOST) ?? pickFree(1);
      if (h === undefined) continue;
      used.add(base + h);
      const ip = intToIp(base + h);

      // ゲートウェイが未設定で、同じセグメントにルーターのアドレスがあれば、それにする
      const gateway =
        node.gateway === null
          ? (routerAddressesOn({ nodes, links: net.links }, env.engine, m.node, m.port).find((r) =>
              inSubnet(r, cfg.network, cfg.prefix),
            ) ?? null)
          : node.gateway;

      nodes = nodes.map((n) =>
        n.uid === node.uid
          ? { ...n, interfaces: [...n.interfaces, { port: m.port, ip, prefix: cfg.prefix }], gateway }
          : n,
      );
      changed = true;
    }
  }

  if (!changed) return core;
  return withNet(core, target, { ...net, nodes });
};
