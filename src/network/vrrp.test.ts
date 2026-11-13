import { ping } from './engine';
import { analyze } from './engine/analyze';
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { effectivePriority, electVrrpMaster, vrrpMac } from './vrrp';
import type { Iface, NetLink, NetNode, Network, PortConfig } from './types';
import type { VrrpGroup } from './vrrp';

const data = gameEnv.engine;
const f = (port: number, ip: string, vrrp?: VrrpGroup[]): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ...(vrrp ? { vrrp } : {}) });
const node = (uid: string, device: string, serial: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: serial, x: 0, y: 0, locked: false, configLocked: extra.gateway !== undefined, interfaces: [], gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const shut = (port: number): PortConfig => ({ port, mode: 'routed', shutdown: true });
const g = (vrid: number, ip: string, priority = 100, extra: Partial<VrrpGroup> = {}): VrrpGroup => ({ vrid, ip, priority, preempt: true, ...extra });

// PC —(SW1)— R1・R2 —(SW2)— サーバー。端末側の仮想 IP は 192.168.1.254（VRID 1）、サーバー側は 10.0.9.254（VRID 2）
const build = (r1: Partial<NetNode> = {}, r2: Partial<NetNode> = {}, r1Track = false): Network => ({
  nodes: [
    node('host', 'pc_basic', 1, { interfaces: [{ id: 'eth0', kind: 'port', port: 0, ip: '192.168.1.10', prefix: 24 }], gateway: '192.168.1.254' }),
    node('sw1', 'l2_switch_8p', 2),
    node('r1', 'router_basic', 3, { interfaces: [f(0, '192.168.1.1', [g(1, '192.168.1.254', 110, r1Track ? { track: [{ iface: 'g0/1', decrement: 20 }] } : {})]), f(1, '10.0.9.1', [g(2, '10.0.9.254', 110)])], ...r1 }),
    node('r2', 'router_basic', 4, { interfaces: [f(0, '192.168.1.2', [g(1, '192.168.1.254', 100)]), f(1, '10.0.9.2', [g(2, '10.0.9.254', 100)])], ...r2 }),
    node('sw2', 'l2_switch_8p', 5),
    node('srv', 'server_basic', 6, { interfaces: [{ id: 'eth0', kind: 'port', port: 0, ip: '10.0.9.10', prefix: 24 }], gateway: '10.0.9.254', services: [] }),
  ],
  links: [link('a', 'host', 0, 'sw1', 0), link('b', 'sw1', 1, 'r1', 0), link('c', 'sw1', 2, 'r2', 0), link('d', 'r1', 1, 'sw2', 0), link('e', 'r2', 1, 'sw2', 1), link('f', 'srv', 0, 'sw2', 2)],
  segments: {},
});
const via = (net: Network) => ping(analyze(net, data), 'host', 'srv');

describe('VRRP のマスターの選出', () => {
  const m = (uid: string, ip: string, priority: number, up = true, extra: Partial<VrrpGroup> = {}) => ({ uid, realIp: ip, group: g(1, '10.0.0.254', priority, extra), downTracked: [] as string[], up });
  it('優先度が高いほうがマスター。同じなら実の IP アドレスが大きいほう', () => {
    expect(electVrrpMaster([m('a', '10.0.0.1', 100), m('b', '10.0.0.2', 110)])).toBe('b');
    expect(electVrrpMaster([m('a', '10.0.0.1', 100), m('b', '10.0.0.2', 100)])).toBe('b');
  });
  it('止まっていれば選ばれず、全員が止まっていれば null。仮想 IP と実の IP が同じ機器は 255', () => {
    expect(electVrrpMaster([m('a', '10.0.0.1', 200, false), m('b', '10.0.0.2', 100)])).toBe('b');
    expect(electVrrpMaster([m('a', '10.0.0.1', 100, false)])).toBeNull();
    expect(effectivePriority({ ...m('a', '10.0.0.254', 100) })).toBe(255);
  });
  it('プリエンプトなしなら、動いている直前のマスターを替えない', () => {
    const list = [m('a', '10.0.0.1', 100, true, { preempt: false }), m('b', '10.0.0.2', 110)];
    expect(electVrrpMaster(list, 'a')).toBe('a');
    expect(electVrrpMaster([m('a', '10.0.0.1', 100), m('b', '10.0.0.2', 110)], 'a')).toBe('b');
  });
  it('仮想 MAC は VRID の16進2桁', () => {
    expect(vrrpMac(10)).toBe('00:00:5e:00:01:0a');
  });
});

describe('VRRP と通信', () => {
  it('優先度の高い R1 がマスターで、PC の通信は R1 を通る', () => {
    const r = via(build());
    expect(r.ok).toBe(true);
    expect(r.path).toContain('r1');
    expect(r.path).not.toContain('r2');
  });
  it('マスター R1 の端末側の口が止まると、R2 が引き継ぐ', () => {
    const r = via(build({ ports: [shut(0), shut(1)] }));
    expect(r.ok).toBe(true);
    expect(r.path).toContain('r2');
  });
  it('追跡: 上流の口（g0/1）が止まると優先度が下がり、端末側でも R2 がマスターになる', () => {
    const r = via(build({ ports: [shut(1)] }, {}, true));
    expect(r.ok).toBe(true);
    expect(r.path).toContain('r2');
  });
  it('同じ VRID の全員が止まっていれば vrrp.no_master', () => {
    const r = via(build({ ports: [shut(0)] }, { ports: [shut(0)] }));
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).toBe('vrrp.no_master');
  });
});

describe('VRRP の警告', () => {
  it('端末のゲートウェイが実の IP アドレスなら vrrp.gateway_real_ip、仮想の IP アドレスが食い違えば vrrp.vip_mismatch', async () => {
    const { warningsOf } = await import('./netState');
    const net = build();
    expect(warningsOf(net)).toEqual([]);
    expect(warningsOf({ ...net, nodes: net.nodes.map((n) => (n.uid === 'host' ? { ...n, gateway: '192.168.1.1' } : n)) })).toEqual([{ id: 'vrrp.gateway_real_ip', a: 'host', b: 'r1' }]);
    const bad = { ...net, nodes: net.nodes.map((n) => (n.uid === 'r2' ? { ...n, interfaces: [f(0, '192.168.1.2', [g(1, '192.168.1.253')]), n.interfaces[1]] } : n)) };
    expect(warningsOf(bad)).toContainEqual({ id: 'vrrp.vip_mismatch', a: 'r1', b: 'r2' });
  });
});

describe('VRRP のターミナル', () => {
  it('vrrp の ip・priority・preempt・track を読み、show vrrp はマスターとバックアップを出す', async () => {
    const { parseConfig } = await import('./terminalConfig');
    const { runTerminal } = await import('./terminal');
    const tr = (k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k);
    expect(parseConfig('vrrp 0 1 ip 192.168.1.254', tr)).toEqual({ kind: 'action', action: { kind: 'vrrp', op: 'ip', port: 0, vrid: 1, ip: '192.168.1.254' } });
    expect(parseConfig('vrrp 0 1 priority 110', tr)).toEqual({ kind: 'action', action: { kind: 'vrrp', op: 'priority', port: 0, vrid: 1, value: 110 } });
    expect(parseConfig('no vrrp 0 1 preempt', tr)).toEqual({ kind: 'action', action: { kind: 'vrrp', op: 'preempt', port: 0, vrid: 1, on: false } });
    expect(parseConfig('vrrp 0 1 track 1 decrement 20', tr)).toEqual({ kind: 'action', action: { kind: 'vrrp', op: 'track', port: 0, vrid: 1, trackPort: 1, decrement: 20 } });
    const net = build();
    const show = (uid: string) => runTerminal('show vrrp', { node: net.nodes.find((n) => n.uid === uid)!, nodes: net.nodes, links: net.links, data }, tr);
    expect(show('r1')[0].text).toContain('"state":"Master"');
    expect(show('r2')[0].text).toContain('"state":"Backup"');
  });
});

describe('survive_device_failure（機器の電源）', () => {
  it('VRRP でゲートウェイを冗長にすると、ルーターのどちらを止めても届く。実の IP アドレスのゲートウェイでは、止めると届かない', async () => {
    const { evaluateGoal } = await import('./goals');
    const goal = { type: 'survive_device_failure' as const, nodes: ['r1', 'r2'] };
    expect(evaluateGoal(goal, build(), data)[0].ok).toBe(true);
    const real: Network = { ...build(), nodes: build().nodes.map((n) => (n.uid === 'host' ? { ...n, gateway: '192.168.1.1' } : n.uid === 'srv' ? { ...n, gateway: '10.0.9.1' } : n)) };
    expect(evaluateGoal(goal, real, data)[0].ok).toBe(false);
  });
  it('電源を切ったマスターは、バックアップが引き継ぐ', () => {
    const net = build();
    const off: Network = { ...net, nodes: net.nodes.map((n) => (n.uid === 'r1' ? { ...n, powered: false } : n)) };
    expect(via(off).path).toContain('r2');
  });
});
