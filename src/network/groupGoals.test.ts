// 役割で指す目標（isolated・http_from）と、ひな形の $role:<役割> の置き換え
import { describe, expect, it } from 'vitest';
import { evaluateGoal } from './goals';
import type { EngineData, NetLink, NetNode, Network } from './types';
import { instantiateTemplate } from '../contracts/template';
import type { ContractTemplate, GameMap, Goal } from '../data/schema';

const data: EngineData = {
  categoryOf: (device) => ({ pc: 'pc', server: 'server', l2_switch: 'l2_switch' })[device] ?? 'unknown',
  maxLengthOf: () => 30,
};

const host = (uid: string, device: string, ip: string): NetNode => ({
  uid,
  device,
  x: 0,
  y: 0,
  locked: false,
  configLocked: false,
  interfaces: [{ port: 0, ip, prefix: 24 }],
  gateway: null,
  routes: [],
  services: device === 'server' ? [{ protocol: 'http', port: 80 }] : [],
});

const sw = (uid: string): NetNode => ({ ...host(uid, 'l2_switch', '0.0.0.0'), interfaces: [] });

const link = (uid: string, a: string, b: string, bPort: number): NetLink => ({
  uid,
  cable: 'utp_cat5e',
  a: { node: a, port: 0 },
  b: { node: b, port: bPort },
  path: [
    [0, 0],
    [5, 0],
  ],
});

// 店員の PC 2台とサーバーをスイッチ s1 に、お客さんの PC 2台をスイッチ s2 につなぐ。bridged なら s1 と s2 もつなぐ
const twoNets = (bridged: boolean): Network => ({
  nodes: [
    host('staff_1', 'pc', '192.168.1.10'),
    host('staff_2', 'pc', '192.168.1.11'),
    host('sv', 'server', '192.168.1.20'),
    host('guest_1', 'pc', '192.168.1.30'),
    host('guest_2', 'pc', '192.168.1.31'),
    sw('s1'),
    sw('s2'),
  ],
  links: [
    link('l1', 'staff_1', 's1', 0),
    link('l2', 'staff_2', 's1', 1),
    link('l3', 'sv', 's1', 2),
    link('l4', 'guest_1', 's2', 0),
    link('l5', 'guest_2', 's2', 1),
    ...(bridged ? [{ ...link('l6', 's1', 's2', 2), a: { node: 's1', port: 3 } }] : []),
  ],
});

describe('isolated', () => {
  const goal: Goal = { type: 'isolated', from: ['guest_1', 'guest_2'], to: ['staff_1', 'staff_2'] };
  it('別のスイッチに分けていれば合格（組ごとに判定する）', () => {
    const results = evaluateGoal(goal, twoNets(false), data);
    expect(results).toHaveLength(4);
    expect(results.every((r) => r.ok)).toBe(true);
  });
  it('1か所でも通信できれば不合格', () => {
    expect(evaluateGoal(goal, twoNets(true), data).some((r) => !r.ok)).toBe(true);
  });
});

describe('http_from', () => {
  const goal = { type: 'http_from' as const, nodes: ['staff_1', 'staff_2'], port: 80 };
  it('指定の PC からサーバーを閲覧できれば合格。ほかの PC は問わない', () => {
    expect(evaluateGoal(goal, twoNets(false), data).every((r) => r.ok)).toBe(true);
  });
  it('指定の PC から届かなければ不合格', () => {
    const g = { ...goal, nodes: ['guest_1'] };
    expect(evaluateGoal(g, twoNets(false), data).every((r) => !r.ok)).toBe(true);
  });
});

describe('ひな形の役割', () => {
  const map: GameMap = { id: 'm', width: 6, height: 4, tileSize: 32, floor: 'wood', legend: { '.': 'floor' }, tiles: ['......', '......', '......', '......'] };
  const template = {
    id: 't_x',
    stage: 1,
    unlockLevel: 1,
    requires: [],
    weight: 1,
    deadlineDays: 5,
    map: 'm',
    spawnGroups: [
      { x: 0, y: 0, width: 6, height: 2, min: 2, max: 2, role: 'staff', name: '店員のPC' },
      { x: 0, y: 2, width: 6, height: 2, min: 2, max: 2, role: 'guest', name: 'お客さんのPC' },
    ],
    budget: { base: 0, perPc: 0, perTile: 0 },
    reward: { base: 0, perPc: 0 },
    goals: [
      { type: 'ping_all', nodes: ['$role:staff'] },
      { type: 'isolated', from: ['$role:guest'], to: ['$role:staff'] },
    ],
    announce: true,
  } as ContractTemplate;
  it('$role:<役割> をその役割の PC に置き換え、PC に番号付きの名前を付ける', () => {
    const { contract } = instantiateTemplate(template, map, 0, 1).offer;
    expect(contract.placed.map((p) => p.ref)).toEqual(['staff_1', 'staff_2', 'guest_1', 'guest_2']);
    expect(contract.placed.map((p) => p.name)).toEqual(['店員のPC1', '店員のPC2', 'お客さんのPC1', 'お客さんのPC2']);
    expect(contract.goals).toEqual([
      { type: 'ping_all', nodes: ['staff_1', 'staff_2'] },
      { type: 'isolated', from: ['guest_1', 'guest_2'], to: ['staff_1', 'staff_2'] },
    ]);
  });
  it('ない役割を指すと止める', () => {
    const bad = { ...template, goals: [{ type: 'ping_all', nodes: ['$role:boss', '$role:staff'] }] } as ContractTemplate;
    expect(() => instantiateTemplate(bad, map, 0, 1)).toThrow();
  });
});

// t_bank_secure の模範解答: 窓口（192.168.1.0/24）と、事務室とサーバー（192.168.2.0/24）を、ポート2つのファイアウォールで分ける。
// 規則は「窓口からサーバーへの http を許す」1本だけ。既定は拒否のため、窓口から事務室への Ping は止まる
describe('銀行の支店の守り（模範解答で解ける）', () => {
  const bankData: EngineData = {
    categoryOf: (device) => ({ pc: 'pc', server: 'server', l2_switch: 'l2_switch', firewall: 'firewall' })[device] ?? 'unknown',
    maxLengthOf: () => 30,
  };
  const pc = (uid: string, ip: string, gw: string): NetNode => ({ ...host(uid, 'pc', ip), gateway: gw });
  const fw = (rules: NetNode['rules']): NetNode => ({
    ...sw('fw'),
    device: 'firewall',
    interfaces: [
      { port: 0, ip: '192.168.1.1', prefix: 24 },
      { port: 1, ip: '192.168.2.1', prefix: 24 },
    ],
    rules,
  });
  const l = (uid: string, a: string, aPort: number, b: string, bPort: number): NetLink => ({ ...link(uid, a, b, bPort), a: { node: a, port: aPort } });
  const bank = (rules: NetNode['rules']): Network => ({
    nodes: [
      pc('teller_1', '192.168.1.10', '192.168.1.1'),
      pc('teller_2', '192.168.1.11', '192.168.1.1'),
      pc('office_1', '192.168.2.10', '192.168.2.1'),
      pc('office_2', '192.168.2.11', '192.168.2.1'),
      { ...host('sv', 'server', '192.168.2.20'), gateway: '192.168.2.1' },
      sw('s1'),
      sw('s2'),
      fw(rules),
    ],
    links: [
      l('a', 'teller_1', 0, 's1', 0),
      l('b', 'teller_2', 0, 's1', 1),
      l('c', 's1', 2, 'fw', 0),
      l('d', 'office_1', 0, 's2', 0),
      l('e', 'office_2', 0, 's2', 1),
      l('f', 'sv', 0, 's2', 2),
      l('g', 's2', 3, 'fw', 1),
    ],
  });
  const goals: Goal[] = [
    { type: 'http_all', port: 80 },
    { type: 'blocked_all', from: ['teller_1', 'teller_2'], to: ['office_1', 'office_2'] },
  ];
  const allowWeb = { src: '192.168.1.0/24', dst: '192.168.2.20/32', service: 'http' as const, port: 80 };

  it('窓口からサーバーへの http だけを許せば、すべての目標を満たす', () => {
    const results = goals.flatMap((g) => evaluateGoal(g, bank([allowWeb]), bankData));
    expect(results.filter((r) => !r.ok).map((r) => `${r.goal.type} ${r.src}→${r.dst} ${r.failure?.reason ?? ''}`)).toEqual([]);
  });
  it('規則がなければ、窓口からサーバーを閲覧できない', () => {
    expect(evaluateGoal(goals[0], bank([]), bankData).some((r) => !r.ok)).toBe(true);
  });
  it('すべて許すと、窓口から事務室へ届いてしまい不合格', () => {
    expect(evaluateGoal(goals[1], bank([{ src: 'any', dst: 'any', service: 'any' }]), bankData).some((r) => !r.ok)).toBe(true);
  });
});

describe('count_device', () => {
  it('指定の型の機器の台数で判定する（同じカテゴリの別の型は数えない）', () => {
    const goal: Goal = { type: 'count_device', device: 'gpu_server', min: 1 };
    const net = twoNets(false);
    expect(evaluateGoal(goal, net, data)[0].ok).toBe(false);
    const withGpu: Network = { ...net, nodes: [...net.nodes, host('gpu', 'gpu_server', '192.168.1.40')] };
    expect(evaluateGoal(goal, withGpu, data)[0].ok).toBe(true);
  });
});
