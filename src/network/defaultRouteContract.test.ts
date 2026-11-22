// 案件 o002（支店の外への出口を二重にする）: 本社のルーター2台が別々の回線につながり、既定の経路を OSPF で支店のルーターへ配る。片方の回線が切れても、支店から外へ届くと合格する
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/o002_default_route_two_isps.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { Iface, NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const iface = (port: number, ip: string, prefix: number, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...extra });
const router = (uid: string, interfaces: Iface[], extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device: 'router_basic', macSerial: 1, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const cable = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path: [[0, 0], [1, 0]],
  paid: 0,
});

// 想定の解答: 本社のルーター2台（回線へ静的な既定の経路・NAPT・default-information originate）と、支店のルーター（両方へ OSPF）
const solved = (originate: boolean): Network => {
  const hq = (uid: string, wan: string, lan: string): NetNode =>
    router(uid, [iface(0, wan, 24, { nat: 'outside' }), iface(1, lan, 30, { nat: 'inside', ospf: { area: 0 } })], {
      routes: [{ dest: '0.0.0.0', prefix: 0, nextHop: wan.replace(/\.2$/, '.1') }],
      components: { nat: { napt: true }, ospf: { defaultOriginate: originate } },
    });
  return {
    nodes: [
      ...fixedNodes(contract),
      hq('r_hq1', '198.51.100.2', '10.0.10.1'),
      hq('r_hq2', '203.0.113.2', '10.0.11.1'),
      router('r_br', [iface(0, '10.0.10.2', 30, { ospf: { area: 0 } }), iface(1, '10.0.11.2', 30, { ospf: { area: 0 } }), iface(2, '10.0.1.1', 24, { ospf: { area: 0 } })]),
    ],
    links: [
      ...contractLinks(contract),
      cable('w1', 'r_hq1', 0, 'isp_a', 0),
      cable('w2', 'r_hq2', 0, 'isp_b', 0),
      cable('h1', 'r_hq1', 1, 'r_br', 0),
      cable('h2', 'r_hq2', 1, 'r_br', 1),
      cable('b', 'r_br', 2, 'br_sw', 3),
    ],
    plans: {},
  };
};

describe('案件 o002: 支店の外への出口を二重にする', () => {
  it('本社の2台が既定の経路を配ると、片方の回線が切れても合格する', () => {
    expect(evaluateContract(contract, analyze(solved(true), data)).passed).toBe(true);
  });
  it('既定の経路を配らなければ、不合格', () => {
    expect(evaluateContract(contract, analyze(solved(false), data)).passed).toBe(false);
  });
});
