// 案件 b004（2台の境界ルーターを iBGP でつなぐ）: 別々の ISP につながる2台が iBGP で経路を交換し、next-hop-self で互いの経路を使えるようにすると合格する。next-hop-self がなければ不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/b004_ibgp_two_routers.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { Iface, NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const iface = (port: number, ip: string, prefix: number, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...extra });
const cable = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: aPort }, b: { node: b, port: bPort }, path: [[0, 0], [1, 0]], paid: 0 });

// 想定の解答: 境界ルーター2台が社内のスイッチにつながり、それぞれ別の ISP へ eBGP を張る。2台の間は iBGP（AS 65000）。nextHopSelf があれば、iBGP の相手の経路を使える
const solved = (nextHopSelf: boolean): Network => {
  const edge = (uid: string, wan: string, lan: string, ispIp: string, ispAs: number, peerLan: string): NetNode => {
    const placed = fixedNodes(contract).find((n) => n.uid === uid)!;
    return {
      ...placed,
      interfaces: [iface(0, wan, 24, { nat: 'outside' }), iface(1, lan, 24, { nat: 'inside' })],
      components: {
        nat: { napt: true },
        bgp: { asn: 65000, neighbors: [{ ip: ispIp, remoteAs: ispAs }, { ip: peerLan, remoteAs: 65000, ...(nextHopSelf ? { nextHopSelf: true } : {}) }], networks: [{ dest: '192.168.1.0', prefix: 24 }] },
      },
    };
  };
  return {
    nodes: [
      ...fixedNodes(contract).filter((n) => !n.uid.startsWith('edge_')),
      edge('edge_a', '198.51.100.2', '192.168.1.1', '198.51.100.1', 65001, '192.168.1.2'),
      edge('edge_b', '203.0.113.2', '192.168.1.2', '203.0.113.1', 65002, '192.168.1.1'),
      { uid: 'sw', device: 'l2_switch_4p', macSerial: 1, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] } as NetNode,
    ],
    links: [
      ...contractLinks(contract),
      cable('a', 'edge_a', 0, 'isp_a', 0),
      cable('b', 'edge_b', 0, 'isp_b', 0),
      cable('sa', 'edge_a', 1, 'sw', 0),
      cable('sb', 'edge_b', 1, 'sw', 1),
      cable('p1', 'sw', 2, 'staff_a', 0),
      cable('p2', 'sw', 3, 'staff_b', 0),
    ],
    plans: {},
  };
};

describe('案件 b004: 2台の境界ルーターを iBGP でつなぐ', () => {
  it('iBGP の相手に next-hop-self を設定すると合格する', () => {
    expect(evaluateContract(contract, analyze(solved(true), data)).passed).toBe(true);
  });
  it('next-hop-self がなければ、隣接は張れても経路が使えず、bgp_usable だけが不合格になる', () => {
    const result = evaluateContract(contract, analyze(solved(false), data));
    expect(result.results.filter((r) => !r.ok).map((r) => r.goal.type)).toEqual(['bgp_usable']);
  });
});
