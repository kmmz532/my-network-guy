// 達成条件 min_speed: 届き、通り道の速さがすべて指定以上なら合格。遅い区間は speed.slow
import { describe, expect, it } from 'vitest';
import { gameEnv } from '../sim/env';
import { analyze } from './engine/analyze';
import { evaluateGoal } from './goals';
import type { Goal } from '../data/schema';
import type { Iface, NetLink, NetNode, Network, PortConfig } from './types';

const data = gameEnv.engine;
const f = (ip: string): Iface => ({ id: 'eth0', kind: 'port', port: 0, ip, prefix: 24 });
const node = (uid: string, device: string, serial: number, extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: serial, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports: [], ...extra }) as NetNode;
const link = (uid: string, cable: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable, a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const ch = (port: number): PortConfig => ({ port, mode: 'access', channelGroup: 1, lacp: 'active' });

// p1 - sw1 - sw2 - p2。スイッチの間の配線を trunk に渡した配線で差し替える
const office = (trunk: NetLink[], bundled = false): Network => ({
  nodes: [
    node('sw1', 'l2_switch_8p', 1, bundled ? { ports: [ch(0), ch(1)] } : {}),
    node('sw2', 'l2_switch_8p', 2, bundled ? { ports: [ch(0), ch(1)] } : {}),
    node('p1', 'pc_basic', 10, { interfaces: [f('192.168.1.11')] }),
    node('p2', 'pc_basic', 11, { interfaces: [f('192.168.1.12')] }),
  ],
  links: [...trunk, link('d', 'utp_cat5e', 'p1', 0, 'sw1', 2), link('e', 'utp_cat5e', 'p2', 0, 'sw2', 2)],
  plans: {},
});

const goal = (mbps: number): Goal => ({ type: 'min_speed', from: 'p1', to: 'p2', mbps });
const run = (net: Network, mbps: number) => evaluateGoal(goal(mbps), analyze(net, data));

describe('min_speed', () => {
  it('通り道に 100M の配線が1本あると speed.slow。ケーブルを替えると合格', () => {
    const slow = run(office([link('x', 'utp_cat5', 'sw1', 0, 'sw2', 0)]), 1000);
    expect(slow.every((r) => !r.ok && r.failure?.reason === 'speed.slow')).toBe(true);
    expect(slow.map((r) => r.failure?.node).sort()).toEqual(['p1', 'p2']);
    expect(run(office([link('x', 'utp_cat5e', 'sw1', 0, 'sw2', 0)]), 1000).map((r) => r.ok)).toEqual([true]);
  });

  it('まとまった論理リンクは合計の速さで判定する', () => {
    const two = [link('x', 'utp_cat5', 'sw1', 0, 'sw2', 0), link('y', 'utp_cat5', 'sw1', 1, 'sw2', 1)];
    expect(run(office(two, true), 200).map((r) => r.ok)).toEqual([true]);
    expect(run(office(two, true), 1000).every((r) => r.failure?.reason === 'speed.slow')).toBe(true);
    expect(run(office([two[0]]), 200).every((r) => r.failure?.reason === 'speed.slow')).toBe(true);
  });

  it('届かないときは、Ping の失敗をそのまま返す', () => {
    const [r] = run({ ...office([link('x', 'utp_cat5e', 'sw1', 0, 'sw2', 0)]), links: [link('d', 'utp_cat5e', 'p1', 0, 'sw1', 2)] }, 1000);
    expect(r.ok).toBe(false);
    expect(r.failure?.reason).not.toBe('speed.slow');
    expect(r.failure).toBeDefined();
  });
});
