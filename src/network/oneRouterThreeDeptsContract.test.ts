// 案件 k002（ルーター1台で3部署）: スイッチの1本のトランクをルーターにつなぎ、サブインターフェース（g0/1.10・g0/1.20・g0/1.30）で VLAN ごとに中継すると合格する
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import { makeSub } from './iface';
import contractJson from '../../resources/data/contracts/k002_one_router_three_depts.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetLink, NetNode, Network, PortConfig } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const cable = (uid: string, a: string, pa: number, b: string, pb: number): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 }) as NetLink;

// 想定の解答: スイッチの口0・1 が VLAN 10、口2・3 が VLAN 20、口4・5 が VLAN 30。口6 は VLAN 10・20・30 を通すトランクで、ルーターの g0/1 につなぐ
const VLANS = [10, 20, 30] as const;
const access = (port: number, vlan: number): PortConfig => ({ port, mode: 'access', vlan });
const trunk: PortConfig = { port: 6, mode: 'trunk', allowed: [...VLANS] };
const PC_VLAN: [string, number][] = [['dept_a1', 10], ['dept_a2', 10], ['dept_b1', 20], ['dept_b2', 20], ['dept_c1', 30], ['dept_c2', 30]];

const solved = (): Network => {
  const nodes = fixedNodes(contract).map((n): NetNode =>
    n.uid !== 'sw' ? n : { ...n, ports: [...PC_VLAN.map(([, vlan], i) => access(i, vlan)), trunk] },
  );
  const router: NetNode = {
    uid: 'r',
    device: 'router_basic',
    macSerial: 90,
    x: 7,
    y: 5,
    locked: false,
    configLocked: false,
    gateway: null,
    routes: [],
    services: [],
    ports: [],
    interfaces: VLANS.map((v) => makeSub('router_basic', 1, v, `192.168.${v}.1`, 24)),
  } as NetNode;
  const pcLinks = PC_VLAN.map(([pc], i) => cable(`p${i}`, 'sw', i, pc, 0));
  return { nodes: [...nodes, router], links: [...contractLinks(contract), ...pcLinks, cable('t', 'sw', 6, 'r', 1)], plans: {} };
};

describe('案件 k002: ルーター1台で3部署', () => {
  it('サブインターフェースで VLAN ごとに中継すると、部署の中も部署の間も届き、合格する', () => {
    expect(evaluateContract(contract, analyze(solved(), data)).passed).toBe(true);
  });
});
