// 案件 b003（ISP-A を主の回線にする）: ISP-A の隣接に route-map（ローカルプリファレンスを上げる）を適用し、出口を ISP-A にすると合格する。route-map がなければ、アドレスの小さい ISP-B が出口になり不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/b003_primary_isp.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { BgpConfig, Iface, NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const iface = (port: number, ip: string, prefix: number, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...extra });
const device = (uid: string, deviceId: string, interfaces: Iface[]): NetNode =>
  ({ uid, device: deviceId, macSerial: 1, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [] }) as NetNode;
const cable = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: aPort }, b: { node: b, port: bPort }, path: [[0, 0], [1, 0]], paid: 0 });

const A = '203.0.113.1';
const B = '198.51.100.1';

// 想定の解答: 境界ルーターが ISP-A（口0）・ISP-B（口1）へつながり、NAPT と BGP を設定する。routeMap があれば、ISP-A の隣接に route-map（local-preference 200）を適用する
const solved = (routeMap: boolean): Network => {
  const bgp: BgpConfig = {
    asn: 65000,
    neighbors: [{ ip: A, remoteAs: 65001, ...(routeMap ? { routeMapIn: 'PRIMARY' } : {}) }, { ip: B, remoteAs: 65002 }],
    networks: [{ dest: '192.168.1.0', prefix: 24 }],
    ...(routeMap ? { routeMaps: [{ name: 'PRIMARY', seq: 10, localPref: 200 }] } : {}),
  };
  return {
    nodes: [
      ...fixedNodes(contract).map((n) =>
        n.uid !== 'edge' ? n : { ...n, interfaces: [iface(0, '203.0.113.2', 24, { nat: 'outside' }), iface(1, '198.51.100.2', 24, { nat: 'outside' }), iface(2, '192.168.1.1', 24, { nat: 'inside' })], components: { nat: { napt: true }, bgp } },
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
  };
};

describe('案件 b003: ISP-A を主の回線にする', () => {
  it('ISP-A の隣接に route-map でローカルプリファレンスを上げると合格する', () => {
    expect(evaluateContract(contract, analyze(solved(true), data)).passed).toBe(true);
  });
  it('route-map がなければ、アドレスの小さい ISP-B が出口になり、出口の条件だけが不合格になる', () => {
    const result = evaluateContract(contract, analyze(solved(false), data));
    expect(result.results.filter((r) => !r.ok).map((r) => r.goal.type)).toEqual(['bgp_exit']);
  });
});
