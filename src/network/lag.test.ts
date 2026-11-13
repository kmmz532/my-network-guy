import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { ping, stpOf, warningsOf } from './netState';
import { lacpCompatible } from './lag';
import type { Iface, NetLink, NetNode, Network, PortConfig } from './types';

const data = gameEnv.engine;
const f = (ip: string): Iface => ({ id: 'eth0', kind: 'port', port: 0, ip, prefix: 24 });
const node = (uid: string, device: string, serial: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: serial, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const ch = (port: number, lacp: PortConfig['lacp'], extra: Partial<PortConfig> = {}): PortConfig => ({ port, mode: 'access', channelGroup: 1, lacp, ...extra });

// SW1 と SW2 の間を2本で結ぶ。PC1 は SW1、PC2 は SW2。口 0・1 をまとめる
const pair = (a: Partial<PortConfig>[], b: Partial<PortConfig>[], extraLinks: NetLink[] = []): Network => ({
  nodes: [
    node('sw1', 'l2_switch_8p', 1, { ports: [ch(0, 'active'), ch(1, 'active')].map((c, i) => ({ ...c, ...a[i] })) }),
    node('sw2', 'l2_switch_8p', 2, { ports: [ch(0, 'active'), ch(1, 'active')].map((c, i) => ({ ...c, ...b[i] })) }),
    node('p1', 'pc_basic', 10, { interfaces: [f('192.168.1.11')] }),
    node('p2', 'pc_basic', 11, { interfaces: [f('192.168.1.12')] }),
  ],
  links: [link('x', 'sw1', 0, 'sw2', 0), link('y', 'sw1', 1, 'sw2', 1), link('d', 'p1', 0, 'sw1', 2), link('e', 'p2', 0, 'sw2', 2), ...extraLinks],
  segments: {},
});

describe('リンクアグリゲーションの組み合わせ', () => {
  it('active／active・active／passive・on／on はまとまり、passive／passive・on と LACP はまとまらない', () => {
    expect(lacpCompatible('active', 'active')).toBe(true);
    expect(lacpCompatible('active', 'passive')).toBe(true);
    expect(lacpCompatible('passive', 'active')).toBe(true);
    expect(lacpCompatible('on', 'on')).toBe(true);
    expect(lacpCompatible('passive', 'passive')).toBe(false);
    expect(lacpCompatible('on', 'active')).toBe(false);
    expect(lacpCompatible('passive', 'on')).toBe(false);
    expect(lacpCompatible(undefined, 'active')).toBe(false);
  });
});

describe('リンクアグリゲーションの計算', () => {
  it('2本をまとめると、輪にならず（link.loop にならない）通信でき、警告もない', () => {
    const net = pair([], [{ lacp: 'passive' }, { lacp: 'passive' }]);
    expect(ping(net, data, 'p1', 'p2').ok).toBe(true);
    expect(warningsOf(net).filter((w) => w.id === 'lag.mismatch')).toHaveLength(0);
    // スパニングツリーの輪としても数えない（止める口がない）
    expect([...stpOf(net, data).roles.values()].filter((r) => r === 'blocking')).toHaveLength(0);
  });
  it('まとまった1本が切れても通信できる', () => {
    const net = pair([], []);
    const cut: Network = { ...net, links: net.links.filter((l) => l.uid !== 'x') };
    expect(ping(cut, data, 'p1', 'p2').ok).toBe(true);
    const shut: Network = { ...net, nodes: net.nodes.map((n) => (n.uid === 'sw1' ? { ...n, ports: n.ports.map((p) => (p.port === 0 ? { ...p, shutdown: true } : p)) } : n)) };
    expect(ping(shut, data, 'p1', 'p2').ok).toBe(true);
  });
  it('両端を passive にするとまとまらず、2本の輪をスパニングツリーが断つ。警告 lag.mismatch を出す', () => {
    const net = pair([{ lacp: 'passive' }, { lacp: 'passive' }], [{ lacp: 'passive' }, { lacp: 'passive' }]);
    expect(warningsOf(net)).toContainEqual({ id: 'lag.mismatch', a: 'sw1', b: 'sw2' });
    expect([...stpOf(net, data).roles.values()].filter((r) => r === 'blocking')).toHaveLength(1);
    expect(ping(net, data, 'p1', 'p2').ok).toBe(true);
  });
  it('チャネルの番号が違う・片側だけの設定はまとまらない', () => {
    expect(warningsOf(pair([{ channelGroup: 2 }], [])).some((w) => w.id === 'lag.mismatch')).toBe(true);
    expect(warningsOf(pair([{ channelGroup: undefined, lacp: undefined }], [])).some((w) => w.id === 'lag.mismatch')).toBe(true);
  });
  it('口の VLAN が一致しない口は個別の口として残る', () => {
    const net = pair([{ vlan: 10 }, {}], [{ vlan: 20 }, {}]);
    expect(warningsOf(net)).toContainEqual({ id: 'lag.mismatch', a: 'sw1', b: 'sw2' });
  });
  it('trunk の許可する VLAN が違えば、まとまらない', () => {
    const t = (allowed: number[]): Partial<PortConfig> => ({ mode: 'trunk', allowed });
    expect(warningsOf(pair([t([10, 20]), t([10, 20])], [t([10, 20]), t([10, 20])])).some((w) => w.id === 'lag.mismatch')).toBe(false);
    expect(warningsOf(pair([t([10, 20]), t([10, 20])], [t([10, 20]), t([10, 30])])).some((w) => w.id === 'lag.mismatch')).toBe(true);
  });
  it('lag の能力のない機器では、まとめない（設定があっても無視する）', () => {
    const net = pair([], []);
    const poor: Network = { ...net, nodes: net.nodes.map((n) => (n.uid === 'sw1' ? { ...n, device: 'l2_switch_4p' } : n)) };
    expect(warningsOf(poor).some((w) => w.id === 'lag.mismatch')).toBe(false);
    // まとまらないため、2本の輪はスパニングツリーに任される（4 ポートのスイッチは stp を持たない）
    expect(ping(poor, data, 'p1', 'p2').ok).toBe(false);
  });
});
