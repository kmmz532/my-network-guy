// 達成条件 load_balanced: 健全な振り分け先の数。サーバー1台の停止は survive_device_failure で確かめる
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import { evaluateGoal } from './goals';
import { gameEnv } from '../sim/env';
import type { Goal } from '../data/schema';
import type { Iface, NetLink, NetNode, Network, Service } from './types';

const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: x + 1, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const web: Service[] = [{ protocol: 'http', port: 80 }];
const VIP = '10.0.0.100';

// 利用者 u1 - sw0 - lb - sw1 - サーバー s1（と、2台のときは s2）
const build = (servers: number, healthCheck: 'http' | 'none' = 'http', s1Off = false): Network => {
  const members = [{ ip: '10.0.1.11', port: 80 }, { ip: '10.0.1.12', port: 80 }].slice(0, servers);
  return {
    nodes: [
      n('u1', 'pc_basic', [f(0, '10.0.0.11')], 0, { gateway: '10.0.0.1' }),
      n('sw0', 'l2_switch_8p', [], 1),
      n('lb', 'load_balancer', [f(0, VIP), f(1, '10.0.1.1')], 2, {
        components: { loadBalancer: [{ vip: VIP, port: 80, members, method: 'round_robin', healthCheck, snat: true }] },
      }),
      n('sw1', 'l2_switch_8p', [], 3),
      n('s1', 'server_basic', [f(0, '10.0.1.11')], 4, { gateway: '10.0.1.1', services: web, ...(s1Off ? { powered: false } : {}) }),
      ...(servers > 1 ? [n('s2', 'server_basic', [f(0, '10.0.1.12')], 5, { gateway: '10.0.1.1', services: web })] : []),
    ],
    links: [l('a', 'u1', 0, 'sw0', 0), l('c', 'lb', 0, 'sw0', 1), l('d', 'lb', 1, 'sw1', 0), l('e', 's1', 0, 'sw1', 1), ...(servers > 1 ? [l('f', 's2', 0, 'sw1', 2)] : [])],
    plans: {},
  };
};

const balanced = (minHealthy: number): Goal => ({ type: 'load_balanced', from: 'u1', lb: 'lb', port: 80, minHealthy });
const survive = (nodes: string[]): Goal => ({ type: 'survive_device_failure', nodes });
const run = (net: Network, goal: Goal) => evaluateGoal(goal, analyze(net, gameEnv.engine));

describe('load_balanced', () => {
  it('2台とも健全なら minHealthy 2 で合格', () => {
    expect(run(build(2), balanced(2)).map((r) => r.ok)).toEqual([true]);
  });

  it('1台止まり、ヘルスチェックがあれば minHealthy 2 は lb.few_healthy。minHealthy 1 と survive_device_failure は合格', () => {
    const net = build(2, 'http', true);
    const [r] = run(net, balanced(2));
    expect(r.ok).toBe(false);
    expect(r.failure).toEqual({ reason: 'lb.few_healthy', node: 'lb' });
    expect(run(net, balanced(1)).map((x) => x.ok)).toEqual([true]);
    expect(run(build(2), survive(['s1'])).map((x) => x.ok)).toEqual([true]);
  });

  it('届かないときは HTTP の失敗をそのまま返す', () => {
    const [r] = run(build(1, 'http', true), balanced(1));
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).not.toBe('lb.few_healthy');
  });

  it('振り分け先が1台の構成では、survive_device_failure が不合格', () => {
    expect(run(build(1), survive(['s1'])).map((r) => r.ok)).toEqual([false]);
  });
});
