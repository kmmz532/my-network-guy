// OSPF の network 文: 口のアドレスを、prefix とワイルドカードの照合で参加させる
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { analyze } from '../network/engine/analyze';
import { ospfNeighborsOf } from '../network/query/ospfNeighbors';
import { getComponent } from '../network/components';
import type { Iface, NetLink, NetNode } from '../network/types';
import { gameEnv } from './env';
import { initialOffice } from './furniture';
import { setRouting } from './netEdit';
import type { Core } from './project';

const f = (port: number, ip: string, prefix = 24): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix });
const router = (uid: string, interfaces: Iface[]): NetNode =>
  ({ uid, device: 'router_basic', x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports: [] }) as NetNode;
const link: NetLink = { uid: 'l0', cable: 'utp_cat5e', a: { node: 'r1', port: 1 }, b: { node: 'r2', port: 0 }, path: [[0, 0], [1, 0]], paid: 0 };
const coreOf = (): Core =>
  ({
    office: {
      ...initialOffice(balanceJson as unknown as Balance),
      nodes: [router('r1', [f(0, '10.0.1.1'), f(1, '10.0.12.1', 30)]), router('r2', [f(0, '10.0.12.2', 30)])],
      links: [link],
    },
    active: [],
    focus: null,
    owned: {},
  }) as unknown as Core;

const edit = (core: Core, uid: string, change: Parameters<typeof setRouting>[2]): Core => {
  const r = setRouting(core, uid, change, 'office');
  if (!r.ok) throw new Error(r.reason);
  return r.core;
};
const nodeOf = (core: Core, uid: string) => core.office.nodes.find((n) => n.uid === uid)!;
const joined = (core: Core, uid: string) => nodeOf(core, uid).interfaces.filter((i) => i.ospf !== undefined).map((i) => i.id);
const neighbors = (core: Core) => ospfNeighborsOf(analyze(core.office as never, gameEnv.engine), 'r1').length;

describe('OSPF の network 文のワイルドカード', () => {
  it('ワイルドカードの範囲に入る口だけが参加し、文の area で参加する', () => {
    const core = edit(coreOf(), 'r1', { proto: 'ospf', on: true, ip: '10.0.0.0', wildcard: '0.0.255.255', area: 2 });
    expect(joined(core, 'r1')).toEqual(['g0/0', 'g0/1']);
    expect(nodeOf(core, 'r1').interfaces[0].ospf?.area).toBe(2);
    const narrow = edit(coreOf(), 'r1', { proto: 'ospf', on: true, ip: '10.0.1.0', wildcard: '0.0.0.255', area: 0 });
    expect(joined(narrow, 'r1')).toEqual(['g0/0']);
    expect(getComponent(nodeOf(narrow, 'r1'), 'ospf')?.networks).toEqual([{ prefix: '10.0.1.0', wildcard: '0.0.0.255', area: 0 }]);
  });

  it('ワイルドカードが狭く口が外れると、その口は参加せず隣接しない', () => {
    const both = edit(edit(coreOf(), 'r1', { proto: 'ospf', on: true, ip: '10.0.12.0', wildcard: '0.0.0.3', area: 0 }), 'r2', { proto: 'ospf', on: true, ip: '10.0.12.0', wildcard: '0.0.0.3', area: 0 });
    expect(neighbors(both)).toBe(1);
    // r1 の 10.0.12.1 は 10.0.12.2 だけに当たる文から外れる（g0/0 は別の文で参加している）
    let missed = edit(coreOf(), 'r1', { proto: 'ospf', on: true, ip: '10.0.1.0', wildcard: '0.0.0.255', area: 0 });
    missed = edit(missed, 'r2', { proto: 'ospf', on: true, ip: '10.0.12.0', wildcard: '0.0.0.3', area: 0 });
    expect(setRouting(missed, 'r1', { proto: 'ospf', on: true, ip: '10.0.12.2', wildcard: '0.0.0.0', area: 0 }, 'office')).toEqual({ ok: false, reason: 'iface.none' });
    expect(joined(missed, 'r1')).toEqual(['g0/0']);
    expect(neighbors(missed)).toBe(0);
  });
});
