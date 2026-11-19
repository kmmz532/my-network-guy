// 達成条件 public_http: インターネットから、静的 NAT を通って to の port へ HTTP が届く
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import { evaluateGoal } from './goals';
import { gameEnv } from '../sim/env';
import type { Goal } from '../data/schema';
import type { Iface, NetLink, NetNode, Network, Service } from './types';

const f = (port: number, ip: string, prefix = 24, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: x + 1, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const web: Service[] = [{ protocol: 'http', port: 80 }];
const VIP = '10.0.0.100';

type Statics = { port: number; insideIp: string; insidePort: number }[];

// 回線終端 u - ルーター r（外 198.51.100.2・内 10.0.0.1）- スイッチ sw - サーバー srv。lbMode のときは sw にロードバランサー lb（VIP）と、その先のサーバー2台
const build = (statics: Statics, opts: { lb?: boolean; rules?: NonNullable<NetNode['components']>['firewall'] } = {}): Network => ({
  nodes: [
    n('u', 'uplink', [], 0),
    n('r', opts.rules ? 'firewall' : 'router_basic', [f(0, '198.51.100.2', 24, 'outside'), f(1, '10.0.0.1', 24, 'inside')], 1, {
      routes: [{ dest: '0.0.0.0', prefix: 0, nextHop: '198.51.100.1' }],
      components: { nat: { napt: true, statics }, ...(opts.rules ? { firewall: opts.rules } : {}) },
    }),
    n('sw', 'l2_switch_8p', [], 2),
    n('srv', 'server_basic', [f(0, '10.0.0.10')], 3, { gateway: '10.0.0.1', services: web }),
    ...(opts.lb
      ? [
          n('lb', 'load_balancer', [f(0, VIP), f(1, '10.0.1.1')], 4, {
            gateway: '10.0.0.1',
            components: { loadBalancer: [{ vip: VIP, port: 80, members: [{ ip: '10.0.1.11', port: 80 }, { ip: '10.0.1.12', port: 80 }], method: 'round_robin', healthCheck: 'http', snat: true }] },
          }),
          n('sw1', 'l2_switch_8p', [], 5),
          n('s1', 'server_basic', [f(0, '10.0.1.11')], 6, { gateway: '10.0.1.1', services: web }),
          n('s2', 'server_basic', [f(0, '10.0.1.12')], 7, { gateway: '10.0.1.1', services: web }),
        ]
      : []),
  ],
  links: [
    l('a', 'u', 0, 'r', 0),
    l('b', 'r', 1, 'sw', 0),
    l('c', 'srv', 0, 'sw', 1),
    ...(opts.lb ? [l('d', 'lb', 0, 'sw', 2), l('e', 'lb', 1, 'sw1', 0), l('f', 's1', 0, 'sw1', 1), l('g', 's2', 0, 'sw1', 2)] : []),
  ],
  plans: {},
});

const goal = (to: string): Goal => ({ type: 'public_http', to, port: 80 });
const run = (net: Network, to: string) => evaluateGoal(goal(to), analyze(net, gameEnv.engine));

describe('public_http', () => {
  it('静的 NAT でサーバーへ転送すると合格する', () => {
    expect(run(build([{ port: 80, insideIp: '10.0.0.10', insidePort: 80 }]), 'srv').map((r) => r.ok)).toEqual([true]);
  });

  it('静的 NAT がなければ、nat.no_forward で不合格', () => {
    const [r] = run(build([]), 'srv');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('nat.no_forward');
  });

  it('静的 NAT の先が to の機器でなければ不合格', () => {
    expect(run(build([{ port: 80, insideIp: '10.0.0.10', insidePort: 80 }], { lb: true }), 'lb').map((r) => r.ok)).toEqual([false]);
  });

  it('静的 NAT の先が VIP なら、ロードバランサー経由で合格する', () => {
    expect(run(build([{ port: 80, insideIp: VIP, insidePort: 80 }], { lb: true }), 'lb').map((r) => r.ok)).toEqual([true]);
  });

  it('ファイアウォールで止めると不合格', () => {
    const [r] = run(build([{ port: 80, insideIp: '10.0.0.10', insidePort: 80 }], { rules: [] }), 'srv');
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('firewall.denied');
  });
});
