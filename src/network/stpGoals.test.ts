// スパニングツリーの帯の達成条件 survive_link_failure と、警告 stp.blocked_path
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { analyze } from './engine/analyze';
import { evaluateGoal } from './goals';
import { warningsOf } from './query/warnings';
import { withComponent } from './components';
import type { Iface, NetLink, NetNode, Network } from './types';

const data = gameEnv.engine;
const node = (uid: string, device: string, serial: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: serial, x: 0, y: 0, locked: false, configLocked: false, interfaces: [] as Iface[], gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const pc = (uid: string, serial: number, ip: string) => node(uid, 'pc_basic', serial, { interfaces: [{ id: 'eth0', port: 0, ip, prefix: 24 } as Iface] });
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// 3台のスイッチを輪にし、sw2 と sw3 に PC を1台ずつつなぐ
const ring = (): Network => ({
  nodes: [node('sw1', 'l2_switch_8p', 1), node('sw2', 'l2_switch_8p', 2), node('sw3', 'l2_switch_8p', 3), pc('p1', 4, '192.168.1.1'), pc('p2', 5, '192.168.1.2')],
  links: [link('a', 'sw1', 0, 'sw2', 0), link('b', 'sw1', 1, 'sw3', 0), link('c', 'sw2', 1, 'sw3', 1), link('d', 'p1', 0, 'sw2', 2), link('e', 'p2', 0, 'sw3', 2)],
  plans: {},
});
const goal = { type: 'survive_link_failure' as const, links: [['sw1', 'sw2'], ['sw1', 'sw3'], ['sw2', 'sw3']] as [string, string][] };

describe('survive_link_failure', () => {
  it('スイッチの輪では、どの1本を外してもスパニングツリーが別の道を開いて届く', () => {
    expect(evaluateGoal(goal, analyze(ring(), data))[0].ok).toBe(true);
  });
  it('輪でなく1本道なら、外すと届かない', () => {
    const line = { ...ring(), links: ring().links.filter((l) => l.uid !== 'c') };
    expect(evaluateGoal({ ...goal, links: [['sw1', 'sw2']] }, analyze(line, data))[0].ok).toBe(false);
  });
  it('指定した組の間にケーブルがなければ不合格', () => {
    const line = { ...ring(), links: ring().links.filter((l) => l.uid !== 'c') };
    expect(evaluateGoal(goal, analyze(line, data))[0].ok).toBe(false);
  });
});

describe('stp.blocked_path', () => {
  // 中心の core に a・b・c をつなぎ、a と b の間にもケーブルを足して輪にする。既定では MAC の小さい a がルートになる
  const star = (coreRoot: boolean): Network => ({
    nodes: [node('a', 'l2_switch_8p', 1), node('b', 'l2_switch_8p', 2), node('c', 'l2_switch_8p', 3), node('core', 'l2_switch_8p', 4)].map((n) => (coreRoot && n.uid === 'core' ? withComponent(n, 'stp', { priority: 4096 }) : n)),
    links: [link('1', 'core', 0, 'a', 0), link('2', 'core', 1, 'b', 0), link('3', 'core', 2, 'c', 0), link('4', 'a', 1, 'b', 1)],
    plans: {},
  });
  it('ルートが中心より端のスイッチなら警告する', () => {
    expect(warningsOf(analyze(star(false), data))).toContainEqual({ id: 'stp.blocked_path', a: 'a', b: 'core' });
  });
  it('中心のスイッチをルートにすると警告しない', () => {
    expect(warningsOf(analyze(star(true), data)).some((w) => w.id === 'stp.blocked_path')).toBe(false);
  });
  it('3台の輪はどれも中心のため、どれがルートでも警告しない', () => {
    expect(warningsOf(analyze(ring(), data)).some((w) => w.id === 'stp.blocked_path')).toBe(false);
  });
});
