// 最後の山場 z001 の想定の解答（試験と撮影が使う）。本社と支社にスイッチを置き、境界ルーター2台を光ファイバーでつなぐ。
// 機器どうしの OSPF・iBGP・ISP との eBGP・NAPT・静的 NAT・経理サーバーの VLAN を設定した構成と、その費用を返す。
import contractJson from '../../resources/data/contracts/z001_final_campus.json';
import cablesJson from '../../resources/data/cables.json';
import { contractLinks, fixedNodes } from '../sim/project';
import { deviceDef } from '../registry/query';
import { analyze } from '../network/engine/analyze';
import { fillPlans } from '../network/query/plans';
import { gameEnv } from '../sim/env';
import type { Contract } from '../data/schema';
import type { Iface, NetLink, NetNode, Network, PortConfig } from '../network/types';

const contract = contractJson as unknown as Contract;

const iface = (port: number, ip: string, prefix: number, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...extra });
const device = (uid: string, deviceId: string, serial: number, x: number, y: number, ports: PortConfig[] = []): NetNode =>
  ({ uid, device: deviceId, macSerial: serial, x, y, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports }) as NetNode;

const posOf = (nodes: NetNode[], uid: string): [number, number] => {
  const n = nodes.find((x) => x.uid === uid);
  if (!n) throw new Error(`機器がない: ${uid}`);
  return [n.x, n.y];
};

export interface Opts {
  // 経理サーバーの口を VLAN 30 に分けるか
  vlan?: boolean;
  // 拠点の間を OSPF でつなぐか（false なら、静的経路でつなぐ）
  ospf?: boolean;
  // 支社の ISP-B へ BGP を張るか
  bgpB?: boolean;
  // 本社の静的 NAT（外のポート80 → 公開サーバー）を入れるか
  staticNat?: boolean;
  // 支社の境界ルーターを ISP-B へつなぐか
  lineB?: boolean;
}

// 想定の解答: 本社と支社にスイッチを置き、境界ルーター2台をそれぞれの ISP と光ファイバーの拠点間でつなぐ。2台は OSPF で LAN と回線側のネットワークを交換し、iBGP（next-hop-self）と eBGP を張る
export const solvedFinalCampus = (o: Opts = {}): Network => {
  const { vlan = true, ospf = true, bgpB = true, staticNat = true, lineB = true } = o;
  const ospfOn = ospf ? { ospf: { area: 0 } } : {};
  const fixed = fixedNodes(contract);
  const placedNodes = fixed.map((n): NetNode => {
    if (n.uid === 'edge_a') {
      return {
        ...n,
        interfaces: [
          iface(0, '198.51.100.2', 24, { nat: 'outside', ...ospfOn }),
          iface(1, '192.168.1.1', 24, { nat: 'inside', ...ospfOn }),
          iface(2, '192.168.100.1', 24, { nat: 'inside' }),
          iface(4, '10.0.0.1', 30, { nat: 'inside', ...ospfOn }),
        ],
        components: {
          nat: { napt: true, ...(staticNat ? { statics: [{ port: 80, insideIp: '192.168.100.80', insidePort: 80 }] } : {}) },
          bgp: { asn: 65000, neighbors: [{ ip: '198.51.100.1', remoteAs: 65001 }, { ip: '10.0.0.2', remoteAs: 65000, nextHopSelf: true }], networks: [{ dest: '192.168.1.0', prefix: 24 }] },
        },
        routes: ospf ? [] : [{ dest: '192.168.2.0', prefix: 24, nextHop: '10.0.0.2' }],
      };
    }
    if (n.uid === 'edge_b') {
      return {
        ...n,
        interfaces: [
          iface(0, '203.0.113.2', 24, { nat: 'outside', ...ospfOn }),
          iface(1, '192.168.2.1', 24, { nat: 'inside', ...ospfOn }),
          iface(4, '10.0.0.2', 30, { nat: 'inside', ...ospfOn }),
        ],
        components: {
          nat: { napt: true },
          bgp: { asn: 65000, neighbors: [...(bgpB ? [{ ip: '203.0.113.1', remoteAs: 65002 }] : []), { ip: '10.0.0.1', remoteAs: 65000, nextHopSelf: true }], networks: [{ dest: '192.168.2.0', prefix: 24 }] },
        },
        routes: ospf ? [] : [{ dest: '192.168.1.0', prefix: 24, nextHop: '10.0.0.1' }],
      };
    }
    return n;
  });
  const nodes: NetNode[] = [
    ...placedNodes,
    device('sw_hq', 'l2_switch_8p', 101, 5, 5, vlan ? [{ port: 3, mode: 'access', vlan: 30 }] : []),
    device('sw_br', 'l2_switch_4p', 102, 35, 5),
  ];
  const at = (uid: string) => posOf(nodes, uid);
  const cable = (uid: string, a: string, aPort: number, b: string, bPort: number, cableId = 'utp_cat5e'): NetLink => ({ uid, cable: cableId, a: { node: a, port: aPort }, b: { node: b, port: bPort }, path: [at(a), at(b)], paid: 0 });
  const links: NetLink[] = [
    ...contractLinks(contract),
    cable('la', 'edge_a', 0, 'isp_a', 0),
    ...(lineB ? [cable('lb', 'edge_b', 0, 'isp_b', 0)] : []),
    cable('h0', 'sw_hq', 0, 'edge_a', 1),
    cable('h1', 'sw_hq', 1, 'hq_1', 0),
    cable('h2', 'sw_hq', 2, 'hq_2', 0),
    cable('h3', 'sw_hq', 3, 'acc_srv', 0),
    cable('dmz', 'edge_a', 2, 'web', 0),
    cable('wan', 'edge_a', 4, 'edge_b', 4, 'fiber_sm'),
    cable('b0', 'sw_br', 0, 'edge_b', 1),
    cable('b1', 'sw_br', 1, 'br_1', 0),
    cable('b2', 'sw_br', 2, 'br_2', 0),
  ];
  // 配線でできたネットワークごとの設定（セグメント）は、機器のアドレスから作る
  const plans = fillPlans(analyze({ nodes, links, plans: {} }, gameEnv.engine));
  return { nodes, links, plans };
};

// 費用: 案件で置かれた機器（固定でないもの）と、プレイヤーが置いた機器の定価、配線の費用（1本の費用 + 1マスごとの費用 × 長さ）
export const cableCostOfFinalCampus = (net: Network): number => {
  const paid = net.links.filter((l) => l.paid !== undefined && !contractLinks(contract).some((c) => c.uid === l.uid));
  return paid.reduce((s, l) => {
    const def = cablesJson.cables.find((c) => c.id === l.cable);
    if (!def) throw new Error(`ケーブルがない: ${l.cable}`);
    const len = Math.abs(l.path[0][0] - l.path[1][0]) + Math.abs(l.path[0][1] - l.path[1][1]);
    return s + def.pricePerLink + def.pricePerTile * len;
  }, 0);
};

export const costOfFinalCampus = (net: Network): number => {
  const fixed = new Set(contract.placed.filter((p) => p.locked).map((p) => p.ref));
  const devices = net.nodes.filter((n) => !fixed.has(n.uid)).reduce((s, n) => s + deviceDef(n.device).price, 0);
  return devices + cableCostOfFinalCampus(net);
};

