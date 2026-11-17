// 束ねた口（Po）に IP を付ける。Po は、まとまった配線の代表の口として計算される
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { initialOffice } from '../sim/furniture';
import { setChannel, setInterface, setPo } from '../sim/netEdit';
import type { Core, Env } from '../sim/project';
import { analyze } from './engine/analyze';
import { makePo } from './iface';
import { learnedRoutesOf } from './query/learnedRoutes';
import type { EngineData, Iface, NetLink, NetNode, Network, PortConfig } from './types';

const data: EngineData = { wallAt: () => false, interferers: [] };
const node = (uid: string, interfaces: Iface[], ports: PortConfig[]): NetNode =>
  ({ uid, device: 'l3_switch', x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports }) as NetNode;
const link = (uid: string, pa: number, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: 'sw1', port: pa }, b: { node: 'sw2', port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const member = (port: number, extra: Partial<PortConfig> = {}): PortConfig => ({ port, mode: 'routed', channelGroup: 1, lacp: 'active', ...extra });
const ospf = { area: 0 };
const lan = (port: number, ip: string): Iface => ({ id: `g0/${port}`, kind: 'port', port, ip, prefix: 24, ospf });
const po = (ip: string): Iface => ({ ...makePo(1, ip, 30), ospf });

// sw1(10.0.1.0/24 を持つ) と sw2 を、2本の配線を束ねた Po1（10.0.12.0/30）でつなぐ
const pair = (ports1: PortConfig[], ports2: PortConfig[] = [member(0), member(1)]): Network => ({
  nodes: [node('sw1', [po('10.0.12.1'), lan(5, '10.0.1.1')], ports1), node('sw2', [po('10.0.12.2')], ports2)],
  links: [link('a', 0, 0), link('b', 1, 1)],
  plans: {},
});
const learned = (net: Network): string[] => learnedRoutesOf(analyze(net, data), 'sw2', 'ospf').map((r) => `${r.dest}/${r.prefix}`);

describe('束ねた口（Po）の IP', () => {
  it('Po の IP で2台の L3 スイッチが隣接し、OSPF の経路が載る', () => {
    expect(learned(pair([member(0), member(1)]))).toContain('10.0.1.0/24');
  });

  it('メンバーを1本 shutdown しても、経路が残る', () => {
    expect(learned(pair([member(0, { shutdown: true }), member(1)]))).toContain('10.0.1.0/24');
  });

  it('メンバーを全部止めると、経路が消える', () => {
    expect(learned(pair([member(0, { shutdown: true }), member(1, { shutdown: true })]))).not.toContain('10.0.1.0/24');
  });

  it('まとまっていない Po は落ちた口になり、po.not_bundled が出る', () => {
    const state = analyze(pair([member(0), member(1)], [member(0, { channelGroup: 2 }), member(1, { channelGroup: 2 })]), data);
    expect(state.addressing.issues.sw2?.reason).toBe('po.not_bundled');
    expect(state.addressing.nodeOf('sw2')?.interfaces).toEqual([]);
    expect(learned(pair([member(0), member(1)], [member(0, { channelGroup: 2 }), member(1, { channelGroup: 2 })]))).not.toContain('10.0.1.0/24');
  });
});

describe('メンバーの口の IP', () => {
  const env = { balance: balanceJson as unknown as Balance, furniture: {}, engine: data } as unknown as Env;
  const coreOf = (n: NetNode): Core => ({ office: { ...initialOffice(balanceJson as unknown as Balance), nodes: [n] }, active: [], focus: null, owned: {} }) as unknown as Core;

  it('メンバーに IP を付ける編集と、IP のある口をメンバーにする編集は、po.member_has_ip で拒否される', () => {
    const withMember = coreOf(node('sw1', [], [member(0)]));
    expect(setInterface(withMember, 'sw1', 0, '10.0.0.1', 24, env, 'office')).toEqual({ ok: false, reason: 'po.member_has_ip' });
    const withIp = coreOf(node('sw1', [{ id: 'g0/0', kind: 'port', port: 0, ip: '10.0.0.1', prefix: 24 }], [{ port: 0, mode: 'routed' }]));
    expect(setChannel(withIp, 'sw1', { port: 0, group: 1, lacp: 'active' }, 'office')).toEqual({ ok: false, reason: 'po.member_has_ip' });
  });

  it('Po の IP を設定し、空で外せる', () => {
    const core = coreOf(node('sw1', [], []));
    const set = setPo(core, 'sw1', 1, '10.0.12.1', 30, env, 'office');
    expect(set.ok && set.core.office.nodes[0].interfaces.map((i) => [i.id, i.kind, i.channel])).toEqual([['Po1', 'po', 1]]);
    expect(set.ok && setPo(set.core, 'sw1', 1, '', 30, env, 'office')).toMatchObject({ ok: true });
  });
});
