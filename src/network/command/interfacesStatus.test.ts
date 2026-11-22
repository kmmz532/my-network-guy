// show interfaces status と show vlan brief の表示の中身。口ごとの状態（connected・notconnect・disabled）と VLAN（trunk なら trunk）
import { describe, expect, it } from 'vitest';
import type { EngineData, NetLink, NetNode, PortConfig } from '../types';
import { analyze } from '../engine/analyze';
import type { Tr } from '../terminal';
import { commandContextOf, runLine } from './run';
import type { TerminalSession } from './types';

const data: EngineData = { wallAt: () => false, interferers: [] };
const exec: TerminalSession = { mode: 'exec', iface: null, process: null };
const tr: Tr = (key, params) => (params ? `${key} ${JSON.stringify(params)}` : key.replace('ui.terminal.status', '').toLowerCase());

const node = (uid: string, device: string, ports: PortConfig[], vlans?: { id: number; name?: string }[]): NetNode =>
  ({ uid, device, x: 0, y: 0, locked: false, configLocked: false, interfaces: [], gateway: null, routes: [], services: [], ports, components: vlans ? { vlanDefs: vlans } : undefined }) as unknown as NetNode;
const link = (uid: string, port: number): NetLink => ({ uid, cable: 'utp_cat5e', a: { node: 'sw1', port }, b: { node: 'sw2', port }, path: [[0, 0], [1, 0]], paid: 0 });

const sw1 = node('sw1', 'l2_switch_8p', [{ port: 0, mode: 'trunk' }, { port: 1, mode: 'access', vlan: 20 }, { port: 2, mode: 'access', vlan: 10, shutdown: true }], [{ id: 10, name: 'eigyo' }, { id: 20 }]);
const sw2 = node('sw2', 'l2_switch_8p', []);
const links = [link('a', 0), link('b', 2)];
const state = analyze({ nodes: [sw1, sw2], links, plans: {} }, data);
const linesOf = (line: string, unlocked = true): string[] =>
  runLine(line, commandContextOf({ node: sw1, nodes: [sw1, sw2], links, data, state }, false, exec, { unlocked: () => unlocked, hideValues: false }), tr).lines.map((l) => l.text);

describe('show interfaces status', () => {
  it('口ごとに名前・状態・VLAN（trunk は trunk）・速さを出し、停止した口はつながっていても disabled になる', () => {
    const rows = linesOf('show interfaces status').map((l) => l.split(/\s+/));
    expect(rows[0]).toEqual(['port', 'state', 'vlan', 'speed']);
    expect(rows[1].slice(0, 3)).toEqual(['g0/0', 'connected', 'trunk']);
    expect(rows[2].slice(0, 3)).toEqual(['g0/1', 'notconnect', '20']);
    expect(rows[3]).toEqual(['g0/2', 'disabled', '10', 'auto']);
    expect(rows[4].slice(0, 3)).toEqual(['g0/3', 'notconnect', '1']);
    expect(rows).toHaveLength(9);
  });

  it('VLAN を学ぶ前は VLAN の列を出さない', () => {
    expect(linesOf('show interfaces status', false)[0].split(/\s+/)).toEqual(['port', 'state', 'speed']);
  });
});

describe('show vlan brief', () => {
  it('宣言した VLAN の番号と名前を、口の行の後ろに出す', () => {
    const lines = linesOf('show vlan brief');
    expect(lines).toContain('ui.terminal.vlanDeclared {"vlan":10,"name":"eigyo"}');
    expect(lines).toContain('ui.terminal.vlanDeclared {"vlan":20,"name":"ui.terminal.vlanunnamed"}');
  });
});
