// 案件 z001（最後の山場。本社と支社の2拠点）: 部署の分離・拠点の間の OSPF・2社の ISP との BGP・DMZ の公開サーバー・回線の冗長をすべて満たすと合格し、★3 になる。1つでも欠けると不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/z001_final_campus.json';
import balanceJson from '../../resources/data/balance.json';
import cablesJson from '../../resources/data/cables.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import { deviceDef } from '../registry/query';
import { rate } from '../sim/rating';
import type { Balance, Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { Iface, NetLink, NetNode, Network, PortConfig } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;
const balance = balanceJson as unknown as Balance;

const iface = (port: number, ip: string, prefix: number, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...extra });
const device = (uid: string, deviceId: string, x: number, y: number, ports: PortConfig[] = []): NetNode =>
  ({ uid, device: deviceId, macSerial: 1, x, y, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports }) as NetNode;

const posOf = (nodes: NetNode[], uid: string): [number, number] => {
  const n = nodes.find((x) => x.uid === uid);
  if (!n) throw new Error(`機器がない: ${uid}`);
  return [n.x, n.y];
};

interface Opts {
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
const solved = (o: Opts = {}): Network => {
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
    device('sw_hq', 'l2_switch_8p', 5, 5, vlan ? [{ port: 3, mode: 'access', vlan: 30 }] : []),
    device('sw_br', 'l2_switch_4p', 35, 5),
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
  return { nodes, links, plans: {} };
};

// 費用: 案件で置かれた機器（固定でないもの）と、プレイヤーが置いた機器の定価、配線の費用（1本の費用 + 1マスごとの費用 × 長さ）
const costOf = (net: Network): number => {
  const fixed = new Set(contract.placed.filter((p) => p.locked).map((p) => p.ref));
  const devices = net.nodes.filter((n) => !fixed.has(n.uid)).reduce((s, n) => s + deviceDef(n.device).price, 0);
  const paid = net.links.filter((l) => l.paid !== undefined && !contractLinks(contract).some((c) => c.uid === l.uid));
  const cables = paid.reduce((s, l) => {
    const def = cablesJson.cables.find((c) => c.id === l.cable);
    if (!def) throw new Error(`ケーブルがない: ${l.cable}`);
    const len = Math.abs(l.path[0][0] - l.path[1][0]) + Math.abs(l.path[0][1] - l.path[1][1]);
    return s + def.pricePerLink + def.pricePerTile * len;
  }, 0);
  return devices + cables;
};

const failed = (net: Network) => evaluateContract(contract, analyze(net, data)).results.filter((r) => !r.ok).map((r) => r.goal.type);

describe('案件 z001: 本社と支社の2拠点（最後の山場）', () => {
  it('想定の解答で、6つの達成条件がすべて合格する', () => {
    expect(failed(solved())).toEqual([]);
  });
  it('想定の解答の費用は予算の 0.8 倍以下で、★3 になる', () => {
    expect(rate(costOf(solved()), contract.budget, 0, false, 0, balance)).toBe(3);
  });
  it('予算は、想定の解答の費用の 1.25 倍（切り上げ）', () => {
    expect(contract.budget).toBe(Math.ceil(costOf(solved()) * 1.25));
  });
  it('経理サーバーの VLAN を分けなければ、分離の条件が不合格になる', () => {
    expect(new Set(failed(solved({ vlan: false })))).toEqual(new Set(['isolated']));
  });
  it('支社の ISP-B へ BGP を張らなければ、支社の隣接の条件が不合格になる', () => {
    expect(failed(solved({ bgpB: false }))).toContain('bgp_established');
  });
  it('静的 NAT がなければ、公開の条件が不合格になる', () => {
    expect(failed(solved({ staticNat: false }))).toEqual(['public_http']);
  });
  it('拠点の間を静的経路でつなぐと、OSPF の条件が不合格になる', () => {
    expect(failed(solved({ ospf: false }))).toContain('no_static_route');
  });
  it('支社の回線をつながなければ、回線の冗長の条件が不合格になる', () => {
    expect(failed(solved({ lineB: false }))).toContain('survive_uplink_failure');
  });
});
