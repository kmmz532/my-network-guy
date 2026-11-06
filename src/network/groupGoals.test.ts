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
