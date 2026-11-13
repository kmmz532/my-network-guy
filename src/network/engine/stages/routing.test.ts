// 経路の層: 静的・OSPF・BGP の経路が、機器の経路表に1件ずつ出る
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../../../sim/env';
import type { Iface, NetLink, NetNode, Network, Route } from '../../types';
import { stageL2 } from './l2';
import { stageLinks } from './links';
import { stageRouting } from './routing';

const iface = (port: number, ip: string, extra: Partial<Iface> = {}): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...extra });
const node = (uid: string, interfaces: Iface[], extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device: 'router_basic', macSerial: 1, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [] as Route[], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink =>
  ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });

// r1 — r2 — r3。r1 と r2 は OSPF、r2 と r3 は eBGP。r2 には静的経路を1件設定する
const net: Network = {
  nodes: [
    node('r1', [iface(0, '10.0.12.1', { ospf: { area: 0 } }), iface(1, '10.0.1.1', { ospf: { area: 0 } })]),
    node('r2', [iface(0, '10.0.12.2', { ospf: { area: 0 } }), iface(1, '10.0.23.2'), iface(2, '10.0.2.1')], {
      routes: [{ dest: '10.9.0.0', prefix: 24, nextHop: '10.0.23.3' }],
      bgp: { asn: 200, neighbors: [{ ip: '10.0.23.3', remoteAs: 300 }], networks: [{ dest: '10.0.2.0', prefix: 24 }] },
    }),
    node('r3', [iface(0, '10.0.23.3'), iface(1, '10.0.3.1')], {
      bgp: { asn: 300, neighbors: [{ ip: '10.0.23.2', remoteAs: 200 }], networks: [{ dest: '10.0.3.0', prefix: 24 }] },
    }),
  ],
  links: [link('l0', 'r1', 0, 'r2', 0), link('l1', 'r2', 1, 'r3', 0)],
  segments: {},
};

describe('stageRouting', () => {
  it('静的・OSPF・BGP の経路が1件ずつ出る', () => {
    const links = stageLinks(net, gameEnv.engine);
    const routing = stageRouting(links.net, stageL2(links.net, links));
    const routes = routing.routesOf('r2');
    expect(routes.map((r) => [r.dest, r.protocol ?? 'static'])).toEqual([
      ['10.9.0.0', 'static'],
      ['10.0.1.0', 'ospf'],
      ['10.0.3.0', 'bgp'],
    ]);
    expect(routing.bgpOf('r2')?.sessions[0].status.state).toBe('established');
  });
});
