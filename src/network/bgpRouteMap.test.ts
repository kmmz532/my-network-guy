// route-map は、直接の命令（neighbor の local-preference・med・prepend）と同じ結果になる
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { analyze } from './engine/analyze';
import { commandContextOf, runLine } from './command/run';
import { bgpTableOf } from './query/bgpTable';
import type { BgpConfig, Iface, NetNode, Network } from './types';

const data = gameEnv.engine;
const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const router = (uid: string, interfaces: Iface[], bgp: BgpConfig): NetNode =>
  ({ uid, device: 'router_basic', macSerial: 1, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], components: { bgp } }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });
const DEST = { dest: '203.0.113.0', prefix: 24 };
const A = '10.0.1.2';
const B = '10.0.2.2';

// 自社 r0（AS100）が ISP-A（AS200）・ISP-B（AS300）と eBGP で結び、どちらも同じ宛先を広告する。既定では ISP-A（アドレスが小さい）が出口になる
const net = (self: Partial<BgpConfig>, ispA: Partial<BgpConfig['neighbors'][number]> = {}): Network => ({
  nodes: [
    router('r0', [f(0, '10.0.1.1'), f(1, '10.0.2.1')], { asn: 100, neighbors: [{ ip: A, remoteAs: 200 }, { ip: B, remoteAs: 300 }], networks: [], ...self }),
    router('a', [f(0, A)], { asn: 200, neighbors: [{ ip: '10.0.1.1', remoteAs: 100, ...ispA }], networks: [DEST] }),
    router('b', [f(0, B)], { asn: 300, neighbors: [{ ip: '10.0.2.1', remoteAs: 100 }], networks: [DEST] }),
  ],
  links: [link('l1', 'r0', 0, 'a', 0), link('l2', 'r0', 1, 'b', 0)],
  plans: {},
});
const best = (n: Network) => bgpTableOf(analyze(n, data), 'r0')!.candidates.find((c) => c.best && c.dest === DEST.dest)!;

describe('BGP の route-map', () => {
  it('in の route-map でローカルプリファレンスを上げた ISP が、出口に選ばれる', () => {
    expect(best(net({})).from).toBe(A);
    const viaB = net({
      neighbors: [{ ip: A, remoteAs: 200 }, { ip: B, remoteAs: 300, routeMapIn: 'PREFER_B' }],
      routeMaps: [{ name: 'PREFER_B', seq: 10, localPref: 200 }],
    });
    expect(best(viaB).from).toBe(B);
    expect(best(viaB).localPref).toBe(200);
  });

  it('route-map と直接の命令は、同じ結果になる', () => {
    const direct = net({ neighbors: [{ ip: A, remoteAs: 200 }, { ip: B, remoteAs: 300, localPref: 200 }] });
    const viaMap = net({ neighbors: [{ ip: A, remoteAs: 200 }, { ip: B, remoteAs: 300, routeMapIn: 'X' }], routeMaps: [{ name: 'X', seq: 10, localPref: 200 }] });
    expect(bgpTableOf(analyze(viaMap, data), 'r0')).toEqual(bgpTableOf(analyze(direct, data), 'r0'));
  });

  it('out の route-map の prepend と metric は、相手の側から見た経路に効く', () => {
    // ISP-A が自社へ広告する経路に、AS 200 を2つ足させると、AS パスが長くなり ISP-B が選ばれる
    const prepended = net({}, { routeMapOut: 'LONG' });
    prepended.nodes[1].components!.bgp!.routeMaps = [{ name: 'LONG', seq: 10, prepend: [200, 200] }];
    expect(best(prepended).from).toBe(B);
    const direct = net({}, { prepend: 2 });
    expect(bgpTableOf(analyze(prepended, data), 'r0')).toEqual(bgpTableOf(analyze(direct, data), 'r0'));

    const metric = net({}, { routeMapOut: 'M' });
    metric.nodes[1].components!.bgp!.routeMaps = [{ name: 'M', seq: 10, med: 50 }];
    expect(bgpTableOf(analyze(metric, data), 'r0')!.candidates.find((c) => c.from === A)!.med).toBe(50);
  });

  it('存在しない route-map を指す設定は、例外で止める', () => {
    expect(() => best(net({ neighbors: [{ ip: A, remoteAs: 200 }, { ip: B, remoteAs: 300, routeMapIn: 'NONE' }] }))).toThrow('route-map がない');
  });
});

describe('route-map のターミナル', () => {
  const tr = (k: string) => k;
  const ctxOf = (mode: 'config' | 'route-map') => ({ ...commandContextOf({ node: {} as NetNode, nodes: [], links: [], data, state: {} as never }, false), session: { mode, iface: null, process: mode === 'route-map' ? 10 : null, ...(mode === 'route-map' ? { map: 'PREFER_B' } : {}) } });

  it('route-map <名前> permit <番号> でモードに入り、set の3つを読む', () => {
    const entered = runLine('route-map PREFER_B permit 10', ctxOf('config'), tr);
    expect(entered.change).toEqual({ kind: 'bgp', change: { op: 'routeMap', name: 'PREFER_B', seq: 10 } });
    expect(entered.session).toEqual({ mode: 'route-map', iface: null, process: 10, map: 'PREFER_B' });
    const set = (line: string) => runLine(line, ctxOf('route-map'), tr).change;
    expect(set('set local-preference 200')).toEqual({ kind: 'bgp', change: { op: 'routeMapSet', name: 'PREFER_B', seq: 10, key: 'localPref', value: 200 } });
    expect(set('set metric 50')).toEqual({ kind: 'bgp', change: { op: 'routeMapSet', name: 'PREFER_B', seq: 10, key: 'med', value: 50 } });
    expect(set('set as-path prepend 100 100 100')).toEqual({ kind: 'bgp', change: { op: 'routeMapSet', name: 'PREFER_B', seq: 10, key: 'prepend', value: [100, 100, 100] } });
  });

  it('neighbor <ip> route-map <名前> in|out を読む', () => {
    const line = (l: string) => runLine(l, ctxOf('config'), tr).change;
    expect(line('neighbor 10.0.2.2 route-map PREFER_B in')).toEqual({ kind: 'bgp', change: { op: 'neighborRouteMap', ip: '10.0.2.2', dir: 'in', name: 'PREFER_B' } });
    expect(line('neighbor 10.0.2.2 route-map LONG out')).toEqual({ kind: 'bgp', change: { op: 'neighborRouteMap', ip: '10.0.2.2', dir: 'out', name: 'LONG' } });
  });
});
