// 束ねた口（Po）の命令。interface port-channel で入り、ip address で付けた IP は、経路の計算（ping の到達）で使われる
import { describe, expect, it } from 'vitest';
import balanceJson from '../../assets/data/balance.json';
import type { Balance } from '../../data/schema';
import { applyConfig } from '../../company/apply';
import type { ConfigChange } from '../../company/operation';
import { initialOffice } from '../../sim/furniture';
import type { Core, Env } from '../../sim/project';
import { analyze } from '../engine/analyze';
import { ping } from '../engine';
import { makePo } from '../iface';
import type { EngineData, Iface, NetLink, NetNode, PortConfig } from '../types';
import type { NetworkState } from '../engine/state';
import { commandContextOf, runLine } from './run';
import type { TerminalSession } from './types';

const tr = (key: string) => key;
const data: EngineData = { wallAt: () => false, interferers: [] };
const balance = balanceJson as unknown as Balance;
const config: TerminalSession = { mode: 'config', iface: null, process: null };

const node = (uid: string, device: string, interfaces: Iface[], ports: PortConfig[]): NetNode =>
  ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports }) as unknown as NetNode;
const link = (uid: string, pa: number, pb: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: 'sw1', port: pa }, b: { node: 'sw2', port: pb }, path: [[0, 0], [1, 0]], paid: 0 });
const member = (port: number): PortConfig => ({ port, mode: 'routed', channelGroup: 1, lacp: 'active' });

// sw1 の Po1 に IP を付ける命令を打つ。sw2 の Po1（10.0.12.2）と、2本の配線で束ねてある
const env = { balance, furniture: {}, engine: data } as unknown as Env;
const coreOf = (device: string): Core => {
  const sw1 = node('sw1', device, [], [member(0), member(1)]);
  const sw2 = node('sw2', 'l3_switch', [makePo(1, '10.0.12.2', 30)], [member(0), member(1)]);
  return { office: { ...initialOffice(balance), nodes: [sw1, sw2], links: [link('a', 0, 0), link('b', 1, 1)], plans: {} }, active: [], focus: null, owned: {} } as unknown as Core;
};
const reachable = (core: Core): boolean => {
  const net = core.office;
  const state: NetworkState = analyze({ nodes: net.nodes, links: net.links, plans: net.plans }, data);
  return ping(state, 'sw2', 'sw1').ok;
};

describe('束ねた口（Po）の命令', () => {
  it('interface port-channel で Po の口に入り、ip address は Po の IP を設定する。経路の計算で使われる', () => {
    const device = 'l3_switch';
    const core = coreOf(device);
    expect(reachable(core)).toBe(false);

    const entered = runLine('interface port-channel 1', commandContextOf({ node: node('sw1', device, [], []), nodes: [], links: [], data, state: {} as NetworkState }, false, config), tr);
    expect(entered.session).toEqual({ mode: 'interface', iface: { kind: 'po', channel: 1 }, process: null });

    const session = entered.session as TerminalSession;
    const set = runLine('ip address 10.0.12.1 255.255.255.252', commandContextOf({ node: node('sw1', device, [], []), nodes: [], links: [], data, state: {} as NetworkState }, false, session), tr);
    expect(set.change).toEqual({ kind: 'po', channel: 1, ip: '10.0.12.1', prefix: 30 });

    const outcome = applyConfig(core, 'sw1', set.change as ConfigChange, { env, target: 'office' });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(reachable(outcome.core)).toBe(true);
  });

  it('能力 lag と routedPort の両方がない機器では、interface port-channel は入らず誤りを返す', () => {
    const r = runLine('interface port-channel 1', commandContextOf({ node: node('sw1', 'l2_switch_8p', [], []), nodes: [], links: [], data, state: {} as NetworkState }, false, config), tr);
    expect(r.session).toBeNull();
    expect(r.lines[0].text).toBe('ui.error.port.mode');
  });
});
