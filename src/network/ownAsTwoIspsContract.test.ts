// 案件 b002（自社の AS で2社の ISP とつなぐ）: 境界ルーターが両方の ISP と eBGP の隣接を張り、NAPT を設定すると合格する。片方の ISP だけでは不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/b002_own_as_two_isps.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { Iface, NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const iface = (port: number, ip: string, prefix: number, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...extra });
const device = (uid: string, deviceId: string, interfaces: Iface[], extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device: deviceId, macSerial: 1, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const cable = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: aPort }, b: { node: b, port: bPort }, path: [[0, 0], [1, 0]], paid: 0 });

// 想定の解答: 境界ルーターが2社の回線へつながり、BGP の隣接と NAPT を設定する。ISP-B へ向ける隣接を省いた形も作れる
const solved = (neighborB: boolean): Network => ({
  nodes: [
    ...fixedNodes(contract).map((n) =>
      n.uid !== 'edge'
        ? n
        : {
            ...n,
            interfaces: [iface(0, '198.51.100.2', 24, { nat: 'outside' }), iface(1, '203.0.113.2', 24, { nat: 'outside' }), iface(2, '192.168.1.1', 24, { nat: 'inside' })],
            components: {
              nat: { napt: true },
              bgp: { asn: 65000, neighbors: [{ ip: '198.51.100.1', remoteAs: 65001 }, ...(neighborB ? [{ ip: '203.0.113.1', remoteAs: 65002 }] : [])], networks: [{ dest: '192.168.1.0', prefix: 24 }] },
            },
          },
    ),
    device('sw', 'l2_switch_4p', []),
  ],
  links: [
    ...contractLinks(contract),
    cable('a', 'edge', 0, 'isp_a', 0),
    cable('b', 'edge', 1, 'isp_b', 0),
    cable('s', 'edge', 2, 'sw', 0),
    cable('p1', 'sw', 1, 'staff_a', 0),
    cable('p2', 'sw', 2, 'staff_b', 0),
  ],
  plans: {},
});

describe('案件 b002: 自社の AS で2社の ISP とつなぐ', () => {
  it('両方の ISP と eBGP の隣接を張り NAPT を設定すると合格する', () => {
    expect(evaluateContract(contract, analyze(solved(true), data)).passed).toBe(true);
  });
  it('片方の ISP と隣接を張らなければ、不合格', () => {
    expect(evaluateContract(contract, analyze(solved(false), data)).passed).toBe(false);
  });
});
