// IPsec VPN: 拠点間のトンネルが張れる条件と、トンネルを通る通信
import { describe, expect, it } from 'vitest';
import { controlSequence } from './control';
import { ping } from './engine';
import { analyze } from './engine/analyze';
import { withInternet } from './external';
import { framesOf } from './frames';
import type { FrameContext } from './frames';
import { evaluateGoal } from './goals';
import { warningsOf } from './query/warnings';
import { gameEnv } from '../sim/env';
import type { Goal } from '../data/schema';
import { deviceCategory } from '../registry/query';
import type { FirewallRule, Iface, NetLink, NetNode, Network } from './types';

type Tunnel = NonNullable<NonNullable<NetNode['components']>['vpn']>[number];

const f = (port: number, ip: string, prefix = 24, nat?: 'inside' | 'outside'): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix, ...(nat ? { nat } : {}) });
const n = (uid: string, device: string, interfaces: Iface[], x: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: x + 1, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

const A_WAN = '203.0.113.2';
const B_WAN = '198.51.100.2';
const A_LAN = '10.1.0.0/24';
const B_LAN = '10.2.0.0/24';

const tunnelA = (over: Partial<Tunnel> = {}): Tunnel => ({ peer: B_WAN, psk: 'secret', cipher: 'aes', local: A_LAN, remote: B_LAN, ...over });
const tunnelB = (over: Partial<Tunnel> = {}): Tunnel => ({ peer: A_WAN, psk: 'secret', cipher: 'aes', local: B_LAN, remote: A_LAN, ...over });

interface Options {
  a?: Partial<Tunnel>;
  b?: Partial<Tunnel>;
  // 拠点 A の回線とルーターの間に置くファイアウォールの規則（なければ置かない）
  firewall?: FirewallRule[];
  // 拠点 A のルーターで NAPT を使う
  natA?: boolean;
  // 拠点 A の PC とルーターの間に、NAPT をするルーターを置く
  natBefore?: boolean;
}

// 拠点 A: PC a - VPN ルーター ra - 回線終端 ua。拠点 B: PC b - VPN ルーター rb - 回線終端 ub。回線は拠点ごとに別（ISP のアドレスも別）
const build = ({ a, b, firewall, natA = false, natBefore = false }: Options = {}): Network => {
  const aWan = firewall ? '203.0.114.2' : A_WAN;
  const nodes: NetNode[] = [
    n('a', 'pc_basic', [f(0, '10.1.0.10')], 0, { gateway: '10.1.0.1' }),
    n('ra', 'vpn_router', [f(0, aWan, 24, natA ? 'outside' : undefined), f(1, natBefore ? '10.9.0.2' : '10.1.0.1', 24, natA ? 'inside' : undefined)], 1, {
      routes: [
        { dest: '0.0.0.0', prefix: 0, nextHop: firewall ? '203.0.114.1' : '203.0.113.1' },
        ...(natBefore ? [{ dest: '10.1.0.0', prefix: 24, nextHop: '10.9.0.1' }] : []),
      ],
      components: { vpn: [tunnelA(a)], ...(natA ? { nat: { napt: true } } : {}) },
    }),
    n('ua', 'uplink', [], 2, { components: { isp: { name: 'A', network: '203.0.113.0', prefix: 24, ispIp: '203.0.113.1' } } }),
    n('b', 'pc_basic', [f(0, '10.2.0.10')], 3, { gateway: '10.2.0.1' }),
    n('rb', 'vpn_router', [f(0, B_WAN, 24), f(1, '10.2.0.1')], 4, {
      routes: [{ dest: '0.0.0.0', prefix: 0, nextHop: '198.51.100.1' }],
      components: { vpn: [tunnelB({ peer: aWan, ...b })] },
    }),
    n('ub', 'uplink', [], 5),
  ];
  const links: NetLink[] = [l('lb', 'b', 0, 'rb', 1), l('lub', 'rb', 0, 'ub', 0)];
  if (natBefore) {
    nodes.push(n('nr', 'router_basic', [f(0, '10.1.0.1', 24, 'inside'), f(1, '10.9.0.1', 24, 'outside')], 6, { routes: [{ dest: '10.2.0.0', prefix: 24, nextHop: '10.9.0.2' }], components: { nat: { napt: true } } }));
    links.push(l('la', 'a', 0, 'nr', 0), l('lnr', 'nr', 1, 'ra', 1));
  } else {
    links.push(l('la', 'a', 0, 'ra', 1));
  }
  if (firewall) {
    nodes.push(n('fw', 'firewall', [f(0, '203.0.113.2'), f(1, '203.0.114.1')], 7, { components: { firewall } }));
    links.push(l('lfw0', 'ua', 0, 'fw', 0), l('lfw1', 'fw', 1, 'ra', 0));
  } else {
    links.push(l('lua', 'ra', 0, 'ua', 0));
  }
  return { nodes, links, plans: {} };
};

const state = (net: Network) => analyze(net, gameEnv.engine);
const goal: Goal = { type: 'vpn_up', a: 'ra', b: 'rb' };
const up = (net: Network) => evaluateGoal(goal, state(net))[0];

// シーケンス図の IKE の行: フェーズ1（6行）とフェーズ2（3行）。張れないときは、理由の行で止まる
const ike = (net: Network, a = 'ra', b = 'rb') => controlSequence(state(net), { kind: 'vpn', a, b });
describe('IPsec VPN のシーケンス図の行', () => {
  const ALL = ['seq.vpn.p1.1', 'seq.vpn.p1.2', 'seq.vpn.p1.3', 'seq.vpn.p1.4', 'seq.vpn.p1.5', 'seq.vpn.p1.6', 'seq.vpn.p2.1', 'seq.vpn.p2.2', 'seq.vpn.p2.3'];

  it('張れるトンネルは、フェーズ1の3往復とフェーズ2の3行を、この順に並べ、どれも失敗しない', () => {
    const steps = ike(build());
    expect(steps.map((s) => s.label)).toEqual(ALL);
    expect(steps.map((s) => s.from)).toEqual(['ra', 'rb', 'ra', 'rb', 'ra', 'rb', 'ra', 'rb', 'ra']);
    expect(steps.every((s) => s.failure === undefined)).toBe(true);
  });

  it('相手に届かなければ、1行目で止まる', () => {
    const steps = ike(build({ a: { peer: '198.51.100.99' } }));
    expect(steps.map((s) => s.label)).toEqual(['seq.vpn.p1.1']);
    expect(steps[0].failure?.reason).toBe('vpn.peer_unreachable');
  });

  it('暗号の方式が違えば、フェーズ1の2行目で止まる', () => {
    const steps = ike(build({ a: { cipher: '3des' } }));
    expect(steps.map((s) => s.label)).toEqual(['seq.vpn.p1.1', 'seq.vpn.p1.2']);
    expect(steps[1].failure?.reason).toBe('vpn.proposal_mismatch');
  });

  it('事前共有鍵が違えば、フェーズ1の認証の応答（6行目）で止まる', () => {
    const steps = ike(build({ a: { psk: 'other' } }));
    expect(steps.map((s) => s.label)).toEqual(ALL.slice(0, 6));
    expect(steps[5].failure?.reason).toBe('vpn.psk_mismatch');
  });

  it('守るネットワークの組が合わなければ、フェーズ2の2行目で止まる', () => {
    const steps = ike(build({ a: { remote: '10.3.0.0/24' } }));
    expect(steps.map((s) => s.label)).toEqual(ALL.slice(0, 8));
    expect(steps[7].failure?.reason).toBe('vpn.selector_mismatch');
  });
});

describe('IPsec VPN のトンネル', () => {
  it('両端がそろえば張れて、トンネルを通って別の拠点の PC へ ping が届く', () => {
    const net = build();
    expect(up(net).ok).toBe(true);
    const r = ping(state(net), 'a', 'b');
    expect(r.ok).toBe(true);
    expect(r.path).toEqual(['a', 'ra', 'rb', 'b']);
    expect(r.tunnel).toEqual({ ingress: 'ra', egress: 'rb', ingressIp: A_WAN, egressIp: B_WAN });
    expect(r.back).toEqual(['b', 'rb', 'ra', 'a']);
  });

  it('トンネルの区間のフレームは、外側が相手の WAN で、中身が元の通信', () => {
    const s = state(build());
    const deviceOf = (uid: string) => s.net.nodes.find((x) => x.uid === uid)!.device;
    const ctx: FrameContext = { nodes: s.net.nodes, links: s.net.links, categoryOf: deviceCategory, isSwitch: () => false, isRouter: (uid) => deviceOf(uid) !== 'pc_basic' };
    const frames = framesOf(ctx, ping(s, 'a', 'b'));
    const tunneled = frames.filter((x) => x.tunnel !== undefined);
    expect(tunneled.map((x) => x.tunnel)).toEqual([
      { srcIp: A_WAN, dstIp: B_WAN },
      { srcIp: B_WAN, dstIp: A_WAN },
    ]);
    expect(tunneled[0].l3).toMatchObject({ srcIp: '10.1.0.10', dstIp: '10.2.0.10' });
  });

  it('相手の WAN のアドレスが違えば、vpn.peer_unreachable', () => {
    const net = build({ a: { peer: '198.51.100.99' } });
    const r = up(net);
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('vpn.peer_unreachable');
  });

  it('相手がこちらを peer にしていなければ、vpn.peer_unreachable', () => {
    expect(up(build({ b: { peer: '203.0.113.99' } })).failure?.reason).toBe('vpn.peer_unreachable');
  });

  it('事前共有鍵が違えば、vpn.psk_mismatch', () => {
    expect(up(build({ b: { psk: 'other' } })).failure?.reason).toBe('vpn.psk_mismatch');
  });

  it('暗号の方式が違えば、vpn.proposal_mismatch', () => {
    expect(up(build({ b: { cipher: '3des' } })).failure?.reason).toBe('vpn.proposal_mismatch');
  });

  it('守るネットワークの組が左右対称でなければ、vpn.selector_mismatch で、通信もその理由で止まる', () => {
    const net = build({ b: { remote: '10.1.1.0/24' } });
    expect(up(net).failure?.reason).toBe('vpn.selector_mismatch');
    expect(ping(state(net), 'a', 'b').failure?.reason).toBe('vpn.selector_mismatch');
  });

  it('警告: 3DES を使うトンネル', () => {
    const ids = (net: Network) => warningsOf(state(net)).map((w) => w.id).filter((id) => id.startsWith('vpn.'));
    expect(ids(build())).toEqual([]);
    expect(ids(build({ a: { cipher: '3des' }, b: { cipher: '3des' } }))).toEqual(['vpn.weak_cipher', 'vpn.weak_cipher']);
  });

  it('途中のファイアウォールが UDP 500 を止めれば張れず、any の規則で通せば張れる', () => {
    expect(up(build({ firewall: [] })).failure?.reason).toBe('vpn.peer_unreachable');
    expect(up(build({ firewall: [{ src: 'any', dst: 'any', service: 'ping' }] })).ok).toBe(false);
    expect(up(build({ firewall: [{ src: 'any', dst: 'any', service: 'any' }] })).ok).toBe(true);
  });

  it('トンネルに入る通信には、同じルーターの NAPT を掛けない', () => {
    const net = build({ natA: true });
    const r = ping(state(net), 'a', 'b');
    expect(r.ok).toBe(true);
    expect(r.nat).toBeUndefined();
    // 回線の先（ISP）への通信には、NAPT が掛かる
    const withNet = withInternet(net, gameEnv.engine)!;
    const outside = ping(analyze(withNet, gameEnv.engine), 'a', withNet.internetUids[0]);
    expect(outside.ok).toBe(true);
    expect(outside.nat?.router).toBe('ra');
  });

  it('手前の機器が先に NAPT を掛けていれば、vpn.nat_before_tunnel', () => {
    expect(ping(state(build({ natBefore: true })), 'a', 'b').failure?.reason).toBe('vpn.nat_before_tunnel');
  });
});
