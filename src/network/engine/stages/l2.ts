// L2 の層: L2 ドメイン（VLAN を考慮）・スパニングツリーの役割と止まる口・MAC の表
import { isFabricPort, isL3FabricPort, isRelayPort, isRoutingCategory, isSviPort, isSwitchedRouterCategory, ROUTER_SWITCH_LAN_HOST_PORT, SVI_PORT_BASE } from '../../category';
import { can } from '../../capabilities';
import { macOf } from '../../mac';
import { computeStp, type StpResult } from '../../stp';
import { segmentsOf, type Segment } from '../../segments';
import type { EngineData, Endpoint, Iface, NetLink, NetNode, Network, PortConfig } from '../../types';
import { deviceCategory } from '../../../registry/query';
import type { LinkLayer } from './links';

export interface L2Domain {
  members: Endpoint[];
  // 配線が上限長を超えていた場合、その配線の端点
  tooLong?: Endpoint;
  // 配線がループしている場合（同じL2ドメインに、来た道以外の配線で既にたどった口がつながる）、そのループの端点
  loop?: Endpoint;
}

export interface L2Layer {
  // スパニングツリーの結果（stp を持つスイッチの間のリンクで、ブロッキングの口を決める）
  stp(): StpResult;
  // スパニングツリーが止めている口（ブロッキング）か。まとまった口は、代表の口の役割に従う
  isStpBlocked(uid: string, port: number): boolean;
  // 端点と同じL2ドメインに属する機器の端点（VLAN ごとに、口の設定を見て広がる。スイッチは中継するだけで、結果に含めない）
  domainOf(start: Endpoint): L2Domain;
  // ドメインの鍵: ドメインの中で最も小さい機器の uid と口の番号（"uid:port"）。メンバーがいないドメインは null
  keyOf(domain: L2Domain): string | null;
  // 口が機器の内部のスイッチにつながるか
  isFabric(uid: string, port: number): boolean;
  // 口が機器の一員として数えられないか（中継だけの口）
  isRelay(uid: string, port: number): boolean;
  // 口に入るフレームの VLAN
  vlanOf(uid: string, port: number): number;
  // 口がその VLAN のフレームを通すか
  carries(uid: string, port: number, vlan: number): boolean;
  // 端点に配線があるか
  linkAt(ep: Endpoint): { link: NetLink; peer: Endpoint } | undefined;
  // スイッチの MAC の表（口ごとに、同じ L2 ドメインにつながった端末の MAC）
  macTable(uid: string): { port: number; mac: string }[];
  // セグメント（配線とスイッチでつながった機器の集まり）。保存の構成から求め、無線の仮想の配線は含まない
  readonly segments: Segment[];
}

const key = (ep: Endpoint) => `${ep.node}:${ep.port}`;

export const stageL2 = (net: Network, links: LinkLayer, input: Network, world: EngineData): L2Layer => {
  const nodes = new Map<string, NetNode>();
  for (const node of net.nodes) nodes.set(node.uid, node);
  const catOf = (uid: string): string => {
    const node = nodes.get(uid);
    return node ? deviceCategory(node.device) : '';
  };
  const portCfg = (uid: string, port: number): PortConfig | undefined => nodes.get(uid)?.ports?.find((p) => p.port === port);
  // アドレスの残る口。中継だけの口（L2 スイッチではすべての口）のアドレスは、アドレスの層が除く。
  // 除く規則は機器の種類と口の番号だけで決まるため、ここで同じ規則を当て、アドレスの層の結果を待たない（層の順序を保つ）
  const addressed = (uid: string): Iface[] => (nodes.get(uid)?.interfaces ?? []).filter((i) => !isRelayPort(catOf(uid), i.port));
  const hasIpOn = (uid: string, port: number): boolean => addressed(uid).some((i) => i.kind === 'port' && i.port === port);
  const svisOf = (uid: string): Iface[] => addressed(uid).filter((i) => i.kind === 'svi');
  const isFabric = (uid: string, port: number): boolean =>
    isFabricPort(catOf(uid), port) || isL3FabricPort(catOf(uid), port, portCfg(uid, port), hasIpOn(uid, port));
  const isRelay = (uid: string, port: number): boolean =>
    isRelayPort(catOf(uid), port) || isL3FabricPort(catOf(uid), port, portCfg(uid, port), hasIpOn(uid, port));

  const linkByEndpoint = new Map<string, { link: NetLink; peer: Endpoint }>();
  for (const link of net.links) {
    linkByEndpoint.set(key(link.a), { link, peer: link.b });
    linkByEndpoint.set(key(link.b), { link, peer: link.a });
  }
  const linkAt = (ep: Endpoint) => linkByEndpoint.get(key(ep));

  // 機器の内部のスイッチ（中継の口）でつながる口。スイッチ付きルーターは代表の LAN 口を必ず含める
  const fabricBy = new Map<string, number[]>();
  for (const ep of linkByEndpoint.keys()) {
    const [node, port] = ep.split(':');
    if (isFabric(node, Number(port))) {
      const ports = fabricBy.get(node) ?? [];
      ports.push(Number(port));
      fabricBy.set(node, ports);
    }
  }
  for (const [uid, ports] of fabricBy) {
    if (isSwitchedRouterCategory(catOf(uid)) && !ports.includes(ROUTER_SWITCH_LAN_HOST_PORT)) ports.push(ROUTER_SWITCH_LAN_HOST_PORT);
    fabricBy.set(uid, ports);
  }

  // 論理リンクごとの、スパニングツリーの代表の配線（止まっていない最初の配線）。まとまっていない配線は含まない
  const stpRep = new Map<string, string>();
  for (const b of links.lag.bundles) {
    const rep = b.links.find((l) => !links.isShut(l.a.node, l.a.port) && !links.isShut(l.b.node, l.b.port)) ?? b.links[0];
    for (const l of b.links) stpRep.set(l.uid, rep.uid);
  }

  let stpResult: StpResult | undefined;
  const stp = (): StpResult => {
    // まとまった物理のリンクは、代表の1本だけを渡す（論理リンクは1本）
    const reps = [...linkByEndpoint.values()].map((x) => x.link).filter((l, i, all) => all.indexOf(l) === i && (stpRep.get(l.uid) ?? l.uid) === l.uid);
    stpResult ??= computeStp([...nodes.values()], reps, (n) => can(n.device, 'stp'));
    return stpResult;
  };

  const isStpBlocked = (uid: string, port: number): boolean => {
    const linked = linkAt({ node: uid, port });
    const rep = linked ? stpRep.get(linked.link.uid) : undefined;
    const repLink = rep === undefined ? undefined : links.lag.bundles.flatMap((b) => b.links).find((l) => l.uid === rep);
    const end = repLink === undefined ? { node: uid, port } : repLink.a.node === uid ? repLink.a : repLink.b;
    return stp().roles.get(`${end.node}:${end.port}`) === 'blocking';
  };

  const vlanOf = (uid: string, port: number): number => {
    // SVI は、その VLAN の中にいる
    if (isSviPort(port)) return port - SVI_PORT_BASE;
    const cfg = portCfg(uid, port);
    if (cfg?.mode === 'trunk') return cfg.native ?? 1;
    return cfg?.vlan ?? 1;
  };

  const carries = (uid: string, port: number, vlan: number): boolean => {
    if (isSviPort(port)) return port - SVI_PORT_BASE === vlan;
    const cfg = portCfg(uid, port);
    // 設定のない口（機器の口）は、届いたフレームをそのまま受け取る
    if (cfg === undefined) return !isL3FabricPort(catOf(uid), port, undefined, hasIpOn(uid, port)) || vlan === 1;
    if (cfg.mode === 'trunk') return cfg.allowed === undefined || cfg.allowed.includes(vlan);
    return (cfg.vlan ?? 1) === vlan;
  };

  const domainOf = (start: Endpoint): L2Domain => {
    const members: Endpoint[] = [];
    const visited = new Set<string>();
    const startVlan = vlanOf(start.node, start.port);
    const queue: { ep: Endpoint; vlan: number }[] = [{ ep: start, vlan: startVlan }];
    // 同じL2ドメインの配線の数と機器の数。機器を頂点、配線を辺と見て、辺が頂点以上あれば輪になっている
    const cables = new Set<string>();
    const devices = new Set<string>();
    let relay: Endpoint | undefined;
    let tooLong: Endpoint | undefined;

    while (queue.length) {
      const { ep, vlan } = queue.shift()!;
      const k = `${key(ep)}@${vlan}`;
      if (visited.has(k)) continue;
      visited.add(k);
      // 停止している口と、その VLAN を通さない口は、ドメインに入らない
      if (links.isShut(ep.node, ep.port) || isStpBlocked(ep.node, ep.port) || !carries(ep.node, ep.port, vlan)) continue;
      devices.add(ep.node);

      // 機器の口（設定なし）は、届いたフレームの VLAN に属する。設定のある access の口は、その VLAN の口だけ数える
      const cfgMember = portCfg(ep.node, ep.port);
      // 同じ機器の口は、VLAN が違っても1回だけ数える（ドメインの機器の一覧に重複させない）
      if (!isRelay(ep.node, ep.port) && (cfgMember === undefined || vlanOf(ep.node, ep.port) === vlan) && !members.some((m) => key(m) === key(ep))) {
        members.push(ep);
      }
      if (isFabric(ep.node, ep.port)) relay ??= ep;
      const linked = linkAt(ep);
      if (linked) {
        const { link, peer } = linked;
        // 相手が access の口なら、フレームはその口の VLAN になる（機器側の口には VLAN の設定がないため）
        const cfgPeer = portCfg(peer.node, peer.port);
        const peerVlan = cfgPeer?.mode === 'access' ? vlanOf(peer.node, peer.port) : vlan;
        if (!links.isShut(peer.node, peer.port) && !isStpBlocked(peer.node, peer.port) && carries(peer.node, peer.port, peerVlan)) {
          // 配線は、実際にたどったものだけを数える（輪の判定に使う）
          cables.add(links.lag.representative.get(link.uid) ?? link.uid);
          if (!tooLong && links.tooLong.has(link.uid)) {
            tooLong = ep;
          }
          queue.push({ ep: peer, vlan: peerVlan });
        }
      }
      // 機器の内部のスイッチに入ったら、同じ VLAN を通す口をすべてたどる。SVI（VLAN のインターフェース）は、同じ VLAN のスイッチの中に入る
      if (isFabric(ep.node, ep.port) || isSviPort(ep.port)) {
        for (const port of fabricBy.get(ep.node) ?? []) {
          queue.push({ ep: { node: ep.node, port }, vlan });
        }
        for (const svi of svisOf(ep.node)) {
          if (svi.vlan === vlan) queue.push({ ep: { node: ep.node, port: svi.port }, vlan });
        }
      }
    }
    // 輪になっていれば、輪の中のスイッチ（なければ始点）を示す
    const loop = cables.size >= devices.size ? (relay ?? start) : undefined;
    return { members, tooLong, loop };
  };

  const keyOf = (domain: L2Domain): string | null => {
    let best: Endpoint | undefined;
    for (const m of domain.members) {
      if (best === undefined || m.node < best.node || (m.node === best.node && m.port < best.port)) best = m;
    }
    return best === undefined ? null : key(best);
  };

  const macTable = (uid: string): { port: number; mac: string }[] => {
    if (!nodes.has(uid)) return [];
    const out: { port: number; mac: string }[] = [];
    for (const port of [...new Set(net.links.filter((l) => l.a.node === uid || l.b.node === uid).map((l) => (l.a.node === uid ? l.a.port : l.b.port)))].sort((a, b) => a - b)) {
      for (const m of domainOf({ node: uid, port }).members) {
        if (m.node === uid) continue;
        const other = nodes.get(m.node);
        if (!other || other.macSerial === undefined || isRoutingCategory(catOf(other.uid))) continue;
        out.push({ port, mac: macOf(deviceCategory(other.device), other.macSerial, m.port) });
      }
    }
    return out;
  };

  const segments = segmentsOf(input, world);
  return { stp, isStpBlocked, domainOf, keyOf, isFabric, isRelay, vlanOf, carries, linkAt, macTable, segments };
};
