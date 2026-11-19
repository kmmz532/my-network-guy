// 制御のパケットの列: ARP が L3 の区間ごとに出ること、DNS → 3ウェイ → 要求・応答 → FIN の順、途中の失敗で止まること、NAPT の変換の前後が残ること
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import { controlSequence } from './control';
import { gameEnv } from '../sim/env';
import type { Iface, NetLink, NetNode, Network, Service } from './types';

const f = (port: number, ip: string, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...extra });
let serial = 0;
const n = (uid: string, device: string, interfaces: Iface[], extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], macSerial: ++serial, ...extra }) as NetNode;
const l = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const web: Service[] = [{ protocol: 'http', port: 80 }];
const state = (net: Network) => analyze(net, gameEnv.engine);
const protos = (steps: ReturnType<typeof controlSequence>, proto: string) => steps.filter((s) => s.proto === proto);

// PC - r1 - r2 - サーバー（静的経路で往復する）
const twoRouters = (): Network => ({
  nodes: [
    n('pc', 'pc_basic', [f(0, '10.0.1.10')], { gateway: '10.0.1.1' }),
    n('r1', 'router_basic', [f(0, '10.0.1.1'), f(1, '10.0.2.1')], { routes: [{ dest: '10.0.3.0', prefix: 24, nextHop: '10.0.2.2' }] }),
    n('r2', 'router_basic', [f(0, '10.0.2.2'), f(1, '10.0.3.1')], { routes: [{ dest: '10.0.1.0', prefix: 24, nextHop: '10.0.2.1' }] }),
    n('srv', 'server_basic', [f(0, '10.0.3.10')], { gateway: '10.0.3.1', services: web }),
  ],
  links: [l('a', 'pc', 0, 'r1', 0), l('b', 'r1', 1, 'r2', 0), l('c', 'r2', 1, 'srv', 0)],
  plans: {},
});

describe('ping の列', () => {
  it('ルーター2台を越えると、ARP は L3 の区間ごとに出て、ICMP の要求・応答の数は区間の数に合う', () => {
    const steps = controlSequence(state(twoRouters()), { kind: 'ping', from: 'pc', to: 'srv' });
    const arp = protos(steps, 'arp');
    expect(arp.filter((s) => s.to === '*').map((s) => [s.from, s.reached])).toEqual([['pc', ['r1']], ['r1', ['r2']], ['r2', ['srv']]]);
    expect(arp).toHaveLength(6);
    expect(steps.filter((s) => s.label === 'seq.icmp.request').map((s) => s.path)).toEqual([['pc', 'r1'], ['r1', 'r2'], ['r2', 'srv']]);
    expect(steps.filter((s) => s.label === 'seq.icmp.reply').map((s) => s.path)).toEqual([['srv', 'r2'], ['r2', 'r1'], ['r1', 'pc']]);
    expect(steps.every((s) => s.failure === undefined)).toBe(true);
    // ARP は ICMP より前
    expect(steps.map((s) => s.proto).lastIndexOf('arp')).toBeLessThan(steps.findIndex((s) => s.proto === 'icmp'));
  });
});

describe('HTTP の列', () => {
  // PC・DNS サーバー（権威）・Web サーバーを同じスイッチにつなぐ
  const named = (): Network => ({
    nodes: [
      n('pc', 'pc_basic', [f(0, '10.0.0.10')], { components: { resolver: { nameServer: '10.0.0.53' } } }),
      n('dns', 'server_basic', [f(0, '10.0.0.53')], { services: [{ protocol: 'dns', role: 'auth', zone: [{ type: 'A', name: 'www.corp.test', value: '10.0.0.80' }] }] }),
      n('srv', 'server_basic', [f(0, '10.0.0.80')], { services: web }),
      n('sw', 'l2_switch_8p', []),
    ],
    links: [l('a', 'pc', 0, 'sw', 0), l('b', 'dns', 0, 'sw', 1), l('c', 'srv', 0, 'sw', 2)],
    plans: {},
  });

  it('名前で引くと、DNS → 3ウェイ → 要求・応答 → FIN の順に並ぶ', () => {
    const steps = controlSequence(state(named()), { kind: 'http', from: 'pc', to: 'srv', port: 80, name: 'www.corp.test' });
    expect(steps.filter((s) => s.proto !== 'arp').map((s) => s.label)).toEqual([
      'seq.dns.query',
      'seq.dns.response',
      'seq.tcp.syn',
      'seq.tcp.synack',
      'seq.tcp.ack',
      'seq.http.request',
      'seq.http.response',
      'seq.tcp.fin',
      'seq.tcp.ack',
      'seq.tcp.fin',
      'seq.tcp.ack',
    ]);
    expect(steps[0]).toMatchObject({ proto: 'arp', to: '*', reached: ['dns', 'srv'] });
    expect(steps.every((s) => s.failure === undefined)).toBe(true);
  });

  it('名前を引けなければ、問い合わせの後の失敗の行で止まる', () => {
    const steps = controlSequence(state(named()), { kind: 'http', from: 'pc', to: 'srv', port: 80, name: 'none.corp.test' });
    expect(steps.at(-1)).toMatchObject({ label: 'seq.dns.response', failure: { reason: 'name.unresolved' } });
    expect(steps.some((s) => s.proto === 'tcp')).toBe(false);
  });

  it('経路がなければ、届いた所までで止まり、失敗の行が最後に来る', () => {
    const net = twoRouters();
    const noRoute = { ...net, nodes: net.nodes.map((x) => (x.uid === 'r1' ? { ...x, routes: [] } : x)) };
    const steps = controlSequence(state(noRoute), { kind: 'http', from: 'pc', to: 'srv', port: 80 });
    expect(steps.filter((s) => s.failure)).toHaveLength(1);
    expect(steps.at(-1)?.failure?.node).toBe('r1');
    expect(steps.some((s) => s.label === 'seq.tcp.synack')).toBe(false);
  });

  it('ファイアウォールが拒否すると、そこまでの区間を並べて止まる', () => {
    const net = twoRouters();
    const fw = { ...net, nodes: net.nodes.map((x) => (x.uid === 'r2' ? { ...x, device: 'firewall', components: { firewall: [] } } : x)) } as Network;
    const steps = controlSequence(state(fw), { kind: 'http', from: 'pc', to: 'srv', port: 80 });
    expect(steps.at(-1)?.failure?.reason).toBe('firewall.denied');
    expect(steps.filter((s) => s.failure)).toHaveLength(1);
    expect(protos(steps, 'arp').some((s) => s.from === 'r1')).toBe(true);
  });

  it('NAPT を通ると、フレームに変換の前の値が残る', () => {
    const net: Network = {
      nodes: [
        n('pc', 'pc_basic', [f(0, '10.0.0.10')], { gateway: '10.0.0.1' }),
        n('r', 'router_basic', [f(0, '10.0.0.1', { nat: 'inside' }), f(1, '198.51.100.2', { nat: 'outside' })], { components: { nat: { napt: true, statics: [] } } }),
        n('srv', 'server_basic', [f(0, '198.51.100.10')], { gateway: '198.51.100.2', services: web }),
      ],
      links: [l('a', 'pc', 0, 'r', 0), l('b', 'r', 1, 'srv', 0)],
      plans: {},
    };
    const steps = controlSequence(state(net), { kind: 'http', from: 'pc', to: 'srv', port: 80 });
    const syn = steps.find((s) => s.label === 'seq.tcp.syn');
    expect(syn?.frame?.l3.srcIp).toBe('198.51.100.2');
    expect(syn?.frame?.nat?.before.srcIp).toBe('10.0.0.10');
  });
});
