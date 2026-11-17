// show ip interface brief の表。束ねられていない Po は down、束ねた Po は up、停止した口は down になる
import { describe, expect, it } from 'vitest';
import type { EngineData, NetLink, NetNode, PortConfig } from '../types';
import { analyze } from '../engine/analyze';
import { makeIface, makePo, makeSvi } from '../iface';
import type { Tr } from '../terminal';
import { commandContextOf, runLine } from './run';
import type { TerminalSession } from './types';

const data: EngineData = { wallAt: () => false };
const exec: TerminalSession = { mode: 'exec', iface: null, process: null };

// 表の文言は、そのまま読める形で返す（列の並びを試験で確かめるため）
const text: Record<string, (p?: Record<string, string | number>) => string> = {
  'ui.terminal.briefInterface': () => 'Interface',
  'ui.terminal.briefIp': () => 'IP-Address',
  'ui.terminal.briefStatus': () => 'Status',
  'ui.terminal.briefUp': () => 'up',
  'ui.terminal.briefDown': () => 'down',
  'ui.terminal.briefUnassigned': () => 'unassigned',
  'ui.terminal.briefVlan': (p) => `Vlan${p?.vlan}`,
  'ui.terminal.briefPo': (p) => `Port-channel${p?.channel}`,
  'ui.terminal.cfgInterface': (p) => `interface port ${p?.port}`,
  'ui.terminal.cfgPoInterface': (p) => `interface Port-channel${p?.channel}`,
  'ui.terminal.cfgVlanInterface': (p) => `interface Vlan${p?.vlan}`,
  'ui.terminal.cfgAddress': (p) => `ip address ${p?.ip} ${p?.prefix}`,
};
const tr: Tr = (key, params) => {
  const f = text[key];
  if (!f) throw new Error(`試験に文言がない: ${key}`);
  return f(params);
};

const node = (uid: string, device: string, interfaces: NetNode['interfaces'], ports: PortConfig[]): NetNode =>
  ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces, gateway: null, routes: [], services: [], ports }) as unknown as NetNode;
const link = (uid: string, port: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: 'sw1', port }, b: { node: 'sw2', port }, path: [[0, 0], [1, 0]], paid: 0 });
const member = (port: number): PortConfig => ({ port, mode: 'routed', channelGroup: 1, lacp: 'active' });

// sw1: Po1 は sw2 と2本の配線で束ねてある。Po2 は束ねる口がない。口 2 は停止している。SVI は VLAN 10
const device = 'l3_switch';
const sw1 = node('sw1', device, [makePo(1, '10.0.12.1', 30), makePo(2, '10.0.13.1', 30), makeSvi(10, '10.0.10.1', 24), makeIface(device, 2, '10.0.9.1', 24)], [member(0), member(1), { port: 2, mode: 'routed', shutdown: true }]);
const sw2 = node('sw2', device, [makePo(1, '10.0.12.2', 30)], [member(0), member(1)]);
const links = [link('a', 0), link('b', 1), link('c', 2)];
const state = analyze({ nodes: [sw1, sw2], links, plans: {} }, data);

const linesOf = (line: string): string[] => runLine(line, commandContextOf({ node: sw1, nodes: [sw1, sw2], links, data, state }, false, exec), tr).lines.map((l) => l.text);

describe('show ip interface brief', () => {
  it('物理の口・SVI・Po を1行ずつ出し、束ねられていない Po と停止した口は down になる', () => {
    expect(linesOf('show ip interface brief').map((l) => l.split(/\s+/))).toEqual([
      ['Interface', 'IP-Address', 'Status'],
      ['g0/2', '10.0.9.1', 'down'],
      ['Vlan10', '10.0.10.1', 'up'],
      ['Port-channel1', '10.0.12.1', 'up'],
      ['Port-channel2', '10.0.13.1', 'down'],
    ]);
  });
});

describe('show running-config の口の行', () => {
  it('SVI は interface Vlan<n> と出し、仮想の口の番号（port 1010）では出さない', () => {
    const config = linesOf('show running-config');
    expect(config).toContain('interface Vlan10');
    expect(config).toContain('interface Port-channel1');
    expect(config).not.toContain('interface port 1010');
  });
});
