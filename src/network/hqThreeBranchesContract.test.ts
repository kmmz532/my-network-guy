// 案件 o001（本社と3つの支店を OSPF でつなぐ）: 本社と支店A・B・Cの4台のルーターを、エリア0の OSPF でつなぐと合格する。静的経路は使わない
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/o001_hq_three_branches.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { Iface, NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const iface = (port: number, ip: string, prefix: number): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ospf: { area: 0 } });
const router = (uid: string, interfaces: Iface[]): NetNode =>
  ({ uid, device: 'router_basic', macSerial: 1, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [] }) as NetNode;
const cable = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path: [[0, 0], [1, 0]],
  paid: 0,
});

// 想定の解答: 本社のルーター（スイッチにつなぐ LAN と、3つの支店へのつなぎ）と、支店のルーター（本社へのつなぎと支店の LAN）の4台
const solved = (): Network => ({
  nodes: [
    ...fixedNodes(contract),
    router('r_hq', [iface(0, '10.0.0.1', 24), iface(1, '10.0.10.1', 30), iface(2, '10.0.11.1', 30), iface(3, '10.0.12.1', 30)]),
    router('r_a', [iface(0, '10.0.10.2', 30), iface(1, '10.0.1.1', 24)]),
    router('r_b', [iface(0, '10.0.11.2', 30), iface(1, '10.0.2.1', 24)]),
    router('r_c', [iface(0, '10.0.12.2', 30), iface(1, '10.0.3.1', 24)]),
  ],
  links: [
    ...contractLinks(contract),
    cable('hq', 'hq_sw', 3, 'r_hq', 0),
    cable('ha', 'r_hq', 1, 'r_a', 0),
    cable('hb', 'r_hq', 2, 'r_b', 0),
    cable('hc', 'r_hq', 3, 'r_c', 0),
    cable('aa', 'r_a', 1, 'br_a', 0),
    cable('ab', 'r_b', 1, 'br_b', 0),
    cable('ac', 'r_c', 1, 'br_c', 0),
  ],
  plans: {},
});

describe('案件 o001: 本社と3つの支店を OSPF でつなぐ', () => {
  it('4台のルーターをエリア0の OSPF でつなぐと合格する（静的経路は使わない）', () => {
    expect(evaluateContract(contract, analyze(solved(), data)).passed).toBe(true);
  });
});
