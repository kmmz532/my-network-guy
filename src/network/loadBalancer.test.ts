// ロードバランサー: 仮想の IPアドレスの HTTP を、健全なサーバーへ振り分ける
import { describe, expect, it } from 'vitest';
import { http } from './engine';
import { analyze } from './engine/analyze';
import { gameEnv } from '../sim/env';
import { warningsOf } from './query/warnings';
import type { Iface, NetLink, NetNode, Network, Service } from './types';

type Virtual = NonNullable<NonNullable<NetNode['components']>['loadBalancer']>[number];

const f = (port: number, ip: string, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: x + 1, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

const web: Service[] = [{ protocol: 'http', port: 80 }];
const VIP = '10.0.0.100';

interface Options {
  method?: Virtual['method'];
  healthCheck?: Virtual['healthCheck'];
  snat?: boolean;
  // s1・s2 のサービス（止めるときは空）
  s1?: Service[];
  s2?: Service[];
  // サーバーのゲートウェイ。省略はロードバランサーの口。'router' は利用者と同じネットワークにも口を持つ別のルーター
  gateway?: 'lb' | 'router';
  members?: Virtual['members'];
}

// 利用者 u1・u2 と、ロードバランサーの仮想の IPアドレスが 10.0.0.0/24、サーバー s1・s2 が 10.0.1.0/24。別のルーター r は両方に口を持つ
const build = ({ method = 'round_robin', healthCheck = 'http', snat = true, s1 = web, s2 = web, gateway = 'lb', members }: Options = {}): Network => ({
  nodes: [
    n('u1', 'pc_basic', [f(0, '10.0.0.11')], 0, { gateway: '10.0.0.1' }),
    n('u2', 'pc_basic', [f(0, '10.0.0.12')], 1, { gateway: '10.0.0.1' }),
    n('sw0', 'l2_switch_8p', [], 2),
    n('lb', 'load_balancer', [f(0, VIP), f(1, '10.0.1.1')], 3, {
      components: {
        loadBalancer: [{ vip: VIP, port: 80, members: members ?? [{ ip: '10.0.1.11', port: 80 }, { ip: '10.0.1.12', port: 80 }], method, healthCheck, snat }],
      },
    }),
    n('sw1', 'l2_switch_8p', [], 4),
    n('s1', 'server_basic', [f(0, '10.0.1.11')], 5, { gateway: gateway === 'lb' ? '10.0.1.1' : '10.0.1.254', services: s1 }),
    n('s2', 'server_basic', [f(0, '10.0.1.12')], 6, { gateway: gateway === 'lb' ? '10.0.1.1' : '10.0.1.254', services: s2 }),
    n('r', 'router_basic', [f(0, '10.0.0.254'), f(1, '10.0.1.254')], 7),
  ],
  links: [l('a', 'u1', 0, 'sw0', 0), l('b', 'u2', 0, 'sw0', 1), l('c', 'lb', 0, 'sw0', 2), l('d', 'lb', 1, 'sw1', 0), l('e', 's1', 0, 'sw1', 1), l('f', 's2', 0, 'sw1', 2), l('g', 'r', 0, 'sw0', 3), l('h', 'r', 1, 'sw1', 3)],
  plans: {},
});

// 振り分けられたサーバー（経路に出る s1・s2）。届かなければ失敗の理由
const served = (net: Network, from: string): string => {
  const r = http(analyze(net, gameEnv.engine), from, 'lb', 80);
  return r.ok ? r.path.find((uid) => uid === 's1' || uid === 's2')! : r.failure!.reason;
};

describe('ロードバランサーの振り分け', () => {
  it('round_robin は、送信元ごとに別のサーバーへ割り当てる', () => {
    const net = build();
    const a = served(net, 'u1');
    const b = served(net, 'u2');
    expect([a, b].sort()).toEqual(['s1', 's2']);
  });

  it('source_ip は、同じ送信元を同じサーバーへ割り当てる', () => {
    const net = build({ method: 'source_ip' });
    expect(served(net, 'u1')).toBe(served(build({ method: 'source_ip' }), 'u1'));
    expect(['s1', 's2']).toContain(served(net, 'u2'));
    // 10.0.0.11 は奇数、10.0.0.12 は偶数。2台なら別のサーバーになる
    expect(served(net, 'u1')).not.toBe(served(net, 'u2'));
  });

  it('1台止まったとき、ヘルスチェックがあれば残りのサーバーへ振り分ける', () => {
    const net = build({ s1: [] });
    expect(served(net, 'u1')).toBe('s2');
    expect(served(net, 'u2')).toBe('s2');
    expect(served(build({ s1: [], healthCheck: 'ping' }), 'u1')).toBe('lb.member_down');
  });

  it('1台止まったとき、ヘルスチェックがなければ、止まったサーバーに当たった送信元が lb.member_down', () => {
    const net = build({ s1: [], healthCheck: 'none' });
    const results = [served(net, 'u1'), served(net, 'u2')];
    expect(results.sort()).toEqual(['lb.member_down', 's2']);
  });

  it('全部止まったとき、lb.no_healthy_member', () => {
    expect(served(build({ s1: [], s2: [] }), 'u1')).toBe('lb.no_healthy_member');
  });

  it('SNAT がなく、サーバーのゲートウェイがロードバランサーでなければ lb.asymmetric', () => {
    expect(served(build({ snat: false, gateway: 'router' }), 'u1')).toBe('lb.asymmetric');
  });

  it('SNAT がなくても、サーバーのゲートウェイがロードバランサーなら届く', () => {
    expect(['s1', 's2']).toContain(served(build({ snat: false }), 'u1'));
  });

  it('SNAT があれば、サーバーのゲートウェイがロードバランサーでなくても届く', () => {
    expect(['s1', 's2']).toContain(served(build({ snat: true, gateway: 'router' }), 'u1'));
  });

  it('警告: 振り分け先が1つだけ、ヘルスチェックなし', () => {
    const ids = (net: Network) => warningsOf(analyze(net, gameEnv.engine)).map((w) => w.id).filter((id) => id.startsWith('lb.'));
    expect(ids(build())).toEqual([]);
    expect(ids(build({ members: [{ ip: '10.0.1.11', port: 80 }], healthCheck: 'none' })).sort()).toEqual(['lb.no_health_check', 'lb.single_member']);
  });
});

describe('静的 NAT の先がロードバランサーの仮想の IPアドレス', () => {
  // 外の機器 → NAT のルーター gw（外 203.0.113.1・内 10.0.0.1）→ ロードバランサー（10.0.0.100）→ サーバー
  const external = (): Network => ({
    nodes: [
      n('ext', 'pc_basic', [f(0, '203.0.113.50')], 0, { gateway: '203.0.113.1' }),
      n('gw', 'router_basic', [f(0, '203.0.113.1', 'outside'), f(1, '10.0.0.1', 'inside')], 1, {
        components: { nat: { napt: true, statics: [{ port: 80, insideIp: VIP, insidePort: 80 }] } },
      }),
      n('lb', 'load_balancer', [f(0, VIP), f(1, '10.0.1.1')], 2, {
        gateway: '10.0.0.1',
        components: { loadBalancer: [{ vip: VIP, port: 80, members: [{ ip: '10.0.1.11', port: 80 }, { ip: '10.0.1.12', port: 80 }], method: 'round_robin', healthCheck: 'http', snat: true }] },
      }),
      n('s1', 'server_basic', [f(0, '10.0.1.11')], 3, { gateway: '10.0.1.1', services: web }),
      n('s2', 'server_basic', [f(0, '10.0.1.12')], 4, { gateway: '10.0.1.1', services: web }),
      n('sw0', 'l2_switch_8p', [], 5),
      n('sw1', 'l2_switch_8p', [], 6),
    ],
    links: [l('a', 'ext', 0, 'gw', 0), l('b', 'gw', 1, 'sw0', 0), l('c', 'lb', 0, 'sw0', 1), l('d', 'lb', 1, 'sw1', 0), l('e', 's1', 0, 'sw1', 1), l('f', 's2', 0, 'sw1', 2)],
    plans: {},
  });

  it('外から公開のアドレスへ届き、ロードバランサーが選んだサーバーへ届く', () => {
    const r = http(analyze(external(), gameEnv.engine), 'ext', 'gw', 80);
    expect(r.ok).toBe(true);
    expect(r.path).toContain('lb');
    expect(r.path.some((uid) => uid === 's1' || uid === 's2')).toBe(true);
    expect(r.staticNat?.insideIp).toBe(VIP);
  });
});
