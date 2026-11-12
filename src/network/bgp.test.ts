import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { bgpTableOf, learnedRoutesOf } from './netState';
import type { BgpConfig, Iface, NetNode, Network } from './types';

const f = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24 });
const router = (uid: string, interfaces: Iface[], bgp: BgpConfig): NetNode =>
  ({ uid, device: 'router_basic', x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [], bgp }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number) => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]] as [number, number][], paid: 0 });
const data = gameEnv.engine;
const DEST = { dest: '203.0.113.0', prefix: 24 };

// 自社 R0（AS100）が、ISP A（AS200）・ISP B（AS300）と eBGP で結ぶ。どちらも同じ 203.0.113.0/24 を広告する
const twoIsps = (opts: { prependA?: number; localPrefA?: number }): Network => ({
  nodes: [
    router('r0', [f(0, '10.0.1.1'), f(1, '10.0.2.1')], {
      asn: 100,
      neighbors: [
        { ip: '10.0.1.2', remoteAs: 200, ...(opts.localPrefA ? { localPref: opts.localPrefA } : {}) },
        { ip: '10.0.2.2', remoteAs: 300 },
      ],
      networks: [],
    }),
    router('a', [f(0, '10.0.1.2')], { asn: 200, neighbors: [{ ip: '10.0.1.1', remoteAs: 100, ...(opts.prependA ? { prepend: opts.prependA } : {}) }], networks: [DEST] }),
    router('b', [f(0, '10.0.2.2')], { asn: 300, neighbors: [{ ip: '10.0.2.1', remoteAs: 100 }], networks: [DEST] }),
  ],
  links: [link('l1', 'r0', 0, 'a', 0), link('l2', 'r0', 1, 'b', 0)],
  segments: {},
});

const chosen = (net: Network) => bgpTableOf(net, data, 'r0')!.candidates.find((c) => c.best && c.dest === DEST.dest);

describe('BGP の最適経路の選択', () => {
  it('AS パスが短い方を選ぶ（同じなら隣接のアドレスが小さい方）', () => {
    expect(chosen(twoIsps({}))?.from).toBe('10.0.1.2');
    expect(chosen(twoIsps({ prependA: 2 }))?.from).toBe('10.0.2.2');
  });
  it('ローカルプリファレンスは AS パスより優先される', () => {
    const c = chosen(twoIsps({ prependA: 2, localPrefA: 200 }));
    expect(c?.from).toBe('10.0.1.2');
    expect(c?.path).toEqual([200, 200, 200]);
  });
});

// ISP（AS200）— R1（AS100）— R2（AS100）— R3（AS100）。R1・R2・R3 は iBGP
const ibgp = (nextHopSelf: boolean): Network => ({
  nodes: [
    router('isp', [f(0, '10.0.1.2')], { asn: 200, neighbors: [{ ip: '10.0.1.1', remoteAs: 100 }], networks: [DEST] }),
    router('r1', [f(0, '10.0.1.1'), f(1, '10.0.12.1')], { asn: 100, neighbors: [{ ip: '10.0.1.2', remoteAs: 200 }, { ip: '10.0.12.2', remoteAs: 100, ...(nextHopSelf ? { nextHopSelf: true } : {}) }], networks: [] }),
    router('r2', [f(0, '10.0.12.2'), f(1, '10.0.23.2')], { asn: 100, neighbors: [{ ip: '10.0.12.1', remoteAs: 100 }, { ip: '10.0.23.3', remoteAs: 100 }], networks: [] }),
    router('r3', [f(0, '10.0.23.3')], { asn: 100, neighbors: [{ ip: '10.0.23.2', remoteAs: 100 }], networks: [] }),
  ],
  links: [link('l1', 'isp', 0, 'r1', 0), link('l2', 'r1', 1, 'r2', 0), link('l3', 'r2', 1, 'r3', 0)],
  segments: {},
});

describe('iBGP', () => {
  it('next-hop-self がないと、外の相手のアドレスのままで届かず、経路を使えない', () => {
    const c = bgpTableOf(ibgp(false), data, 'r2')!.candidates.find((x) => x.dest === DEST.dest);
    expect(c?.nextHop).toBe('10.0.1.2');
    expect(c?.valid).toBe(false);
    expect(learnedRoutesOf(ibgp(false), data, 'r2', 'bgp')).toEqual([]);
  });
  it('next-hop-self があれば、iBGP の経路（管理距離 200）として使える', () => {
    const routes = learnedRoutesOf(ibgp(true), data, 'r2', 'bgp');
    expect(routes).toEqual([expect.objectContaining({ dest: DEST.dest, nextHop: '10.0.12.1', ibgp: true })]);
  });
  it('iBGP で学んだ経路は、別の iBGP の相手へ伝えない', () => {
    expect(bgpTableOf(ibgp(true), data, 'r3')!.candidates).toEqual([]);
  });
});

describe('BGP のターミナル', () => {
  it('neighbor の next-hop-self・local-preference・med・prepend を読む', async () => {
    const { parseConfig } = await import('./terminalConfig');
    const tr = (k: string) => k;
    expect(parseConfig('neighbor 10.0.1.2 next-hop-self', tr)).toEqual({ kind: 'action', action: { kind: 'bgp', op: 'attr', ip: '10.0.1.2', key: 'nextHopSelf', value: true } });
    expect(parseConfig('no neighbor 10.0.1.2 next-hop-self', tr)).toEqual({ kind: 'action', action: { kind: 'bgp', op: 'attr', ip: '10.0.1.2', key: 'nextHopSelf', value: false } });
    expect(parseConfig('neighbor 10.0.1.2 local-preference 200', tr)).toEqual({ kind: 'action', action: { kind: 'bgp', op: 'attr', ip: '10.0.1.2', key: 'localPref', value: 200 } });
    expect(parseConfig('neighbor 10.0.1.2 prepend 2', tr)).toEqual({ kind: 'action', action: { kind: 'bgp', op: 'attr', ip: '10.0.1.2', key: 'prepend', value: 2 } });
  });
  it('show ip bgp summary は隣接の状態を、show ip bgp は最適経路の印を出す', async () => {
    const { runTerminal } = await import('./terminal');
    const net = twoIsps({});
    const ctx = { node: net.nodes[0], nodes: net.nodes, links: net.links, data };
    const tr = (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k);
    const summary = runTerminal('show ip bgp summary', ctx, tr);
    expect(summary).toHaveLength(2);
    expect(summary[0].text).toContain('ui.terminal.bgpEstablished');
    const table = runTerminal('show ip bgp', ctx, tr);
    expect(table.some((l) => l.text.includes('"mark":">*"'))).toBe(true);
  });
});
