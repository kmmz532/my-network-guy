// 案件 v001・v003（VLAN）: 設定で VLAN を分けると合格し、置いただけ・分けないままでは不合格
import { describe, expect, it } from 'vitest';
import { analyze } from './engine/analyze';
import v1Json from '../assets/data/contracts/v001_one_switch_two_depts.json';
import v3Json from '../assets/data/contracts/v003_five_depts.json';
import { gameEnv } from '../sim/env';
import type { Contract } from '../data/schema';
import { evaluateGoal } from './goals';
import { makeSvi } from './iface';
import type { NetLink, NetNode, Network, PortConfig } from './types';

const data = gameEnv.engine;
const nodesOf = (c: Contract): NetNode[] =>
  c.placed.map((p, i) => ({
    uid: p.ref,
    device: p.device,
    macSerial: i + 1,
    ports: [],
    x: p.x,
    y: p.y,
    locked: p.locked,
    configLocked: p.config?.locked ?? false,
    interfaces: (p.config?.interfaces ?? []).map((x) => ({ id: 'eth0', kind: 'port' as const, port: x.port, ip: x.ip, prefix: x.prefix })),
    gateway: p.config?.gateway ?? null,
    routes: [],
    services: [],
  }));
const sw = (uid: string, device: string, ports: PortConfig[], interfaces: NetNode['interfaces'] = []): NetNode =>
  ({ uid, device, macSerial: 90, ports, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [] }) as NetNode;
const link = (uid: string, a: string, pa: number, b: string, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: a, port: pa }, b: { node: b, port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const passes = (c: Contract, net: Network) => c.goals.map((g) => evaluateGoal(g, analyze(net, data)).every((r) => r.ok));

describe('案件 v001: 営業と経理を分ける', () => {
  const c = v1Json as unknown as Contract;
  const net = (vlans: [number, number, number, number]): Network => ({
    nodes: [...nodesOf(c), sw('sw', 'l2_switch_8p', vlans.map((vlan, port) => ({ port, mode: 'access' as const, vlan })))],
    links: ['sales_a', 'sales_b', 'acc_a', 'acc_b'].map((ref, i) => link(`l${i}`, ref, 0, 'sw', i)),
    segments: {},
  });
  it('VLAN を分けなければ、通じるが分離の条件を満たさない', () => {
    expect(passes(c, net([1, 1, 1, 1]))).toEqual([true, true, false]);
  });
  it('営業と経理を別の VLAN にすると、3つの条件を満たす', () => {
    expect(passes(c, net([10, 10, 20, 20]))).toEqual([true, true, true]);
  });
});

describe('案件 v003: 部署の間をつなぎ、来客用を切り離す', () => {
  const c = v3Json as unknown as Contract;
  const net = (guestSvi: boolean): Network => {
    const vlans = [10, 20, 30, 40, 99];
    const refs = ['dept_a', 'dept_b', 'dept_c', 'dept_d', 'guest'];
    return {
      nodes: [
        ...nodesOf(c),
        sw('l3', 'l3_switch', vlans.map((vlan, port) => ({ port, mode: 'access' as const, vlan })), [
          makeSvi(10, '192.168.10.1', 24),
          makeSvi(20, '192.168.20.1', 24),
          makeSvi(30, '192.168.30.1', 24),
          makeSvi(40, '192.168.40.1', 24),
          ...(guestSvi ? [makeSvi(99, '192.168.99.1', 24)] : []),
        ]),
      ],
      links: refs.map((ref, i) => link(`l${i}`, ref, 0, 'l3', i)),
      segments: {},
    };
  };
  it('VLAN ごとの SVI で部署の間が通じ、SVI のない来客用の VLAN は切り離される', () => {
    expect(passes(c, net(false))).toEqual([true, true]);
  });
  it('来客用にも SVI を作っても、来客用の PC にゲートウェイがないため、社内へは届かない', () => {
    expect(passes(c, net(true))).toEqual([true, true]);
  });
  it('置いただけでは不合格', () => {
    expect(passes(c, { nodes: nodesOf(c), links: [], segments: {} })[0]).toBe(false);
  });
});
