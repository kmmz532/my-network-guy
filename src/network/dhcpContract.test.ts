// 案件 d001（DHCP・20台）: 部屋ごとのネットワークにルーターのリレーを設定し、サーバーのプールから配ると合格する。リレーがなければ不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import contractJson from '../assets/data/contracts/d001_dhcp_office.json';
import { gameEnv } from '../sim/env';
import type { Contract } from '../data/schema';
import { evaluateGoal } from './goals';
import type { Iface, NetLink, NetNode, Network } from './types';

const contract = contractJson as unknown as Contract;
const data = gameEnv.engine;
const pcs = contract.placed.filter((p) => p.device === 'pc_basic');
const base = (p: (typeof contract.placed)[number], i: number): NetNode =>
  ({
    uid: p.ref,
    device: p.device,
    macSerial: i + 1,
    ports: [],
    x: p.x,
    y: p.y,
    locked: p.locked,
    configLocked: p.config?.locked ?? false,
    interfaces: (p.config?.interfaces ?? []).map((x) => ({ id: 'eth0', kind: 'port' as const, port: x.port, ip: x.ip, prefix: x.prefix, ...(x.dhcp ? { dhcp: true as const } : {}) })),
    gateway: null,
    routes: [],
    services: [],
  }) as NetNode;
const f = (id: string, port: number, ip: string, extra: Partial<Iface> = {}): Iface => ({ id, kind: 'port', port, ip, prefix: 24, ...extra });
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const mk = (uid: string, device: string, serial: number, interfaces: Iface[], extra: Partial<NetNode> = {}): NetNode =>
  ({ uid, device, macSerial: serial, ports: [], x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ...extra }) as NetNode;

const solved = (helper: boolean): Network => {
  const left = pcs.filter((p) => p.x < 10);
  const right = pcs.filter((p) => p.x >= 10);
  const pool = (n: number) => ({ network: `192.168.${n}.0`, prefix: 24, start: `192.168.${n}.100`, end: `192.168.${n}.199`, gateway: `192.168.${n}.1` });
  return {
    nodes: [
      ...pcs.map(base),
      mk('dhcp_srv', 'server_basic', 50, [f('eth0', 0, '10.0.0.2')], { gateway: '10.0.0.1', dhcpPools: [pool(1), pool(2)] }),
      mk('r1', 'router_basic', 51, [f('g0/0', 0, '10.0.0.1'), f('g0/1', 1, '192.168.1.1', helper ? { helper: '10.0.0.2' } : {}), f('g0/2', 2, '192.168.2.1', helper ? { helper: '10.0.0.2' } : {})]),
      mk('swl', 'l2_switch_24p', 52, []),
      mk('swr', 'l2_switch_24p', 53, []),
    ],
    links: [
      link('s', 'dhcp_srv', 0, 'r1', 0),
      link('rl', 'r1', 1, 'swl', 0),
      link('rr', 'r1', 2, 'swr', 0),
      ...left.map((p, i) => link(`l${p.ref}`, p.ref, 0, 'swl', i + 1)),
      ...right.map((p, i) => link(`l${p.ref}`, p.ref, 0, 'swr', i + 1)),
    ],
    segments: {},
  };
};

describe('案件 d001: 社員 20 台のアドレスを自動で配る', () => {
  it('PC は 20 台、すべて自動（dhcp）で始まる', () => {
    expect(pcs).toHaveLength(20);
    expect(pcs.every((p) => p.config?.interfaces.every((i) => i.dhcp === true))).toBe(true);
  });
  it('プールとリレーを設定すると、2つの達成条件を満たす', () => {
    expect(contract.goals.map((g) => evaluateGoal(g, analyze(solved(true), data)).every((r) => r.ok))).toEqual([true, true]);
  });
  it('リレーがなければ、ルーターの先の PC は受け取れず不合格', () => {
    expect(contract.goals.map((g) => evaluateGoal(g, analyze(solved(false), data)).every((r) => r.ok))).toEqual([false, false]);
  });
});
