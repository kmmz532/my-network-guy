// 案件 k001（スイッチは1台だけ）: 今あるスイッチに7台のPCを1本ずつつなぐと合格する。スイッチを増やすと、台数の条件（max_devices）だけが不合格になる
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../../resources/data/contracts/k001_one_switch_only.json';
import { gameEnv } from '../sim/env';
import { contractLinks, fixedNodes } from '../sim/project';
import type { Contract } from '../data/schema';
import { evaluateContract } from './goals';
import type { NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;

const device = (uid: string, deviceId: string): NetNode =>
  ({ uid, device: deviceId, macSerial: 90, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [] }) as NetNode;

// 想定の解答: スイッチの口 i と PC（pc1 から順に）を1本ずつつなぐ
const PCS = ['pc1', 'pc2', 'pc3', 'pc4', 'pc5', 'pc6', 'pc7'];
const cables = (): NetLink[] =>
  PCS.map((pc, i) => ({ uid: `s${i}`, cable: 'utp_cat5e', a: { node: 'sw', port: i }, b: { node: pc, port: 0 }, path: [[6, 5], [0, 0]], paid: 0 }) as NetLink);

const solved = (extraSwitch: boolean): Network => ({
  nodes: [...fixedNodes(contract), ...(extraSwitch ? [device('sw2', 'l2_switch_4p')] : [])],
  links: [...contractLinks(contract), ...cables()],
  plans: {},
});

describe('案件 k001: スイッチは1台だけ', () => {
  it('今あるスイッチに7台のPCをつなぐと、すべて届いて合格する', () => {
    expect(evaluateContract(contract, analyze(solved(false), data)).passed).toBe(true);
  });
  it('スイッチを増やすと、台数の条件だけが不合格になる', () => {
    const result = evaluateContract(contract, analyze(solved(true), data));
    expect(result.results.filter((r) => !r.ok).map((r) => r.goal.type)).toEqual(['max_devices']);
  });
});
