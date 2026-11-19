// 案件 s001（2つの棟を10Gでつなぐ）: 2台の L3 スイッチの SFP の口どうしを光ファイバーでつなぎ、RIP で棟の間の PC を届かせると合格する。rj45 の口どうしを cat6a でつなぐと、口の 1G で speed.slow
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../assets/data/contracts/s001_10g_uplink.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract, evaluateGoal } from './goals';
import type { Iface, NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;
const minSpeed = contract.goals.find((g) => g.type === 'min_speed')!;

const cable = (uid: string, cableId: string, a: string, aPort: number, b: string, bPort: number, path: [number, number][]): NetLink => ({
  uid,
  cable: cableId,
  a: { node: a, port: aPort },
  b: { node: b, port: bPort },
  path,
  paid: 0,
});

// 2台の L3 スイッチで RIP を動かす（棟の間の経路を自動で覚えさせる）
const withRip = (nodes: NetNode[]): NetNode[] =>
  nodes.map((n) => (n.device === 'l3_switch' ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, rip: true })) } : n));

// 幹線の口に、棟の間の直結の IP を先頭に置く（ping の送信元にする）
const uplinkIp = (port: number, ip: string): Iface => ({ id: `eth${port}`, kind: 'port', port, ip, prefix: 30, rip: true });
const withUplinkIp = (nodes: NetNode[], port: number, ips: [string, string]): NetNode[] =>
  nodes.map((n) => (n.device === 'l3_switch' ? { ...n, interfaces: [uplinkIp(port, n.uid === 'HQ_SW' ? ips[0] : ips[1]), ...n.interfaces] } : n));

const net = (nodes: NetNode[], uplink: NetLink): Network => ({
  nodes,
  links: [...contractLinks(contract), uplink],
  plans: {},
});

describe('案件 s001: 2つの棟を10Gでつなぐ', () => {
  it('SFP の口どうしを光ファイバーでつなぎ、RIP で動かすと合格する', () => {
    const fiber = cable('uplink', 'fiber_mm', 'HQ_SW', 8, 'DC_SW', 8, [[8, 5], [27, 5]]);
    expect(evaluateContract(contract, analyze(net(withRip(fixedNodes(contract)), fiber), data)).passed).toBe(true);
  });
  it('rj45 の口どうしを cat6a でつなぐと、口の 1G で speed.slow', () => {
    const copper = cable('uplink', 'cat6a', 'HQ_SW', 1, 'DC_SW', 1, [[8, 5], [27, 5]]);
    const nodes = withUplinkIp(withRip(fixedNodes(contract)), 1, ['10.0.8.1', '10.0.8.2']);
    const results = evaluateGoal(minSpeed, analyze(net(nodes, copper), data));
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((r) => !r.ok && r.failure?.reason === 'speed.slow')).toBe(true);
  });
});
