import { describe, expect, it } from 'vitest';
import type { EngineData, NetNode } from '../types';
import type { NetworkState } from '../engine/state';
import { parseIfaceName } from './args';
import { commandContextOf, runLine } from './run';
import type { TerminalSession } from './types';

const tr = (key: string) => key;
const exec: TerminalSession = { mode: 'exec', iface: null, process: null };
const config: TerminalSession = { mode: 'config', iface: null, process: null };

const node = (device: string): NetNode => ({ uid: 'N1', device, ports: [], interfaces: [], routes: [] }) as unknown as NetNode;
const run = (line: string, session: TerminalSession, device = 'l2_switch_8p', readOnly = false) =>
  runLine(line, commandContextOf({ node: node(device), nodes: [], links: [], data: {} as EngineData, state: {} as NetworkState }, readOnly, session), tr);

describe('interface の名前', () => {
  it('ネットワーク機器は g0/1・gi0/1・gigabitethernet0/1、端末は eth0 を口として読む', () => {
    expect(parseIfaceName('l2_switch_8p', 'g0/1')).toEqual({ kind: 'port', port: 1 });
    expect(parseIfaceName('l2_switch_8p', 'gi0/1')).toEqual({ kind: 'port', port: 1 });
    expect(parseIfaceName('l2_switch_8p', 'GigabitEthernet0/1')).toEqual({ kind: 'port', port: 1 });
    expect(parseIfaceName('pc_basic', 'eth0')).toEqual({ kind: 'port', port: 0 });
  });

  it('機器の種類に合わない名前・ない口・読めない名前は null。vlan10 は SVI', () => {
    expect(parseIfaceName('pc_basic', 'g0/0')).toBeNull();
    expect(parseIfaceName('l2_switch_8p', 'eth0')).toBeNull();
    expect(parseIfaceName('l2_switch_8p', 'g0/99')).toBeNull();
    expect(parseIfaceName('l2_switch_8p', 'port1')).toBeNull();
    expect(parseIfaceName('l2_switch_8p', 'vlan10')).toEqual({ kind: 'svi', vlan: 10 });
    expect(parseIfaceName('l2_switch_8p', 'vlan0')).toBeNull();
  });
});

describe('モードの移り変わり', () => {
  it('configure terminal・interface・exit・end でモードが変わる', () => {
    expect(run('configure terminal', exec).session).toEqual(config);
    expect(run('interface g0/1', config).session).toEqual({ mode: 'interface', iface: { kind: 'port', port: 1 }, process: null });
    expect(run('exit', { mode: 'interface', iface: { kind: 'port', port: 1 }, process: null }).session).toEqual(config);
    expect(run('exit', { mode: 'router-ospf', iface: null, process: 1 }).session).toEqual(config);
    expect(run('exit', config).session).toEqual(exec);
    expect(run('end', { mode: 'interface', iface: { kind: 'port', port: 1 }, process: null }).session).toEqual(exec);
  });

  it('モードにない命令は未知の命令になる（exec の exit・config の show）', () => {
    expect(run('exit', exec).lines).toEqual([{ text: '  ^', kind: 'err' }, { text: 'ui.terminal.invalidAt', kind: 'err' }]);
    expect(run('show ip', config).lines).toEqual([{ text: '  ^', kind: 'err' }, { text: 'ui.terminal.invalidAt', kind: 'err' }]);
  });

  it('ない口・読めない名前の interface は、モードを変えず誤りを返す', () => {
    const r = run('interface g0/99', config);
    expect(r.session).toBeNull();
    expect(r.lines).toEqual([{ text: 'ui.terminal.errInterface', kind: 'err' }]);
  });

  it('config の router ospf は番号が要り、設定が通るときだけ router-ospf に入る。読み取り専用では入らない', () => {
    expect(run('router ospf 7', config).session).toEqual({ mode: 'router-ospf', iface: null, process: 7 });
    expect(run('router ospf', config).lines).toEqual([{ text: '              ^', kind: 'err' }, { text: 'ui.terminal.invalidAt', kind: 'err' }]);
    expect(run('router ospf 7', config, 'l2_switch_8p', true).session).toBeNull();
    expect(run('router ospf 7', exec).session).toBeNull();
    expect(run('router bgp 65001', config).session).toEqual({ mode: 'router-bgp', iface: null, process: 65001 });
    expect(run('router rip', config).session).toEqual({ mode: 'router-rip', iface: null, process: null });
  });
});

describe('interface モードの命令は、対象の口を行に書かない', () => {
  const port1: TerminalSession = { mode: 'interface', iface: { kind: 'port', port: 1 }, process: null };
  const svi10: TerminalSession = { mode: 'interface', iface: { kind: 'svi', vlan: 10 }, process: null };

  it('口の設定の操作は、モードの口に当たる', () => {
    expect(run('ip address 10.0.0.1 255.255.255.0', port1).change).toEqual({ kind: 'iface', port: 1, ip: '10.0.0.1', prefix: 24 });
    expect(run('no ip address', port1).change).toEqual({ kind: 'iface', port: 1, ip: '', prefix: 24 });
    expect(run('switchport access vlan 20', port1).change).toEqual({ kind: 'portMode', port: 1, mode: { kind: 'access', vlan: 20 } });
    expect(run('switchport trunk allowed vlan 10,20', port1).change).toEqual({ kind: 'portMode', port: 1, mode: { kind: 'trunk', allowed: [10, 20] } });
    expect(run('switchport trunk native vlan 10', port1).change).toEqual({ kind: 'portMode', port: 1, mode: { kind: 'trunk', native: 10 } });
    expect(run('switchport mode trunk', port1).change).toEqual({ kind: 'portMode', port: 1, mode: { kind: 'trunk' } });
    expect(run('channel-group 2 mode active', port1).change).toEqual({ kind: 'channel', change: { port: 1, group: 2, lacp: 'active' } });
  });

  it('SVI は ip address だけを受け付け、口の命令は誤りにする', () => {
    expect(run('ip address 10.0.10.1 255.255.255.0', svi10).change).toEqual({ kind: 'svi', vlan: 10, ip: '10.0.10.1', prefix: 24 });
    expect(run('no ip address', svi10).change).toEqual({ kind: 'svi', vlan: 10, ip: '', prefix: 24 });
    expect(run('switchport mode trunk', svi10).lines).toEqual([{ text: 'ui.terminal.errIfaceKind', kind: 'err' }]);
  });

  it('口の番号を行に書く古い形は、interface モードでは受け付けない', () => {
    expect(run('ip address 1 10.0.0.1 255.255.255.0', port1).change).toBeNull();
  });
});

describe('OSPF の番号（router ospf <n>）', () => {
  // 番号を持つ機器（ospf.process が 1）
  const withProcess = { ...node('l2_switch_8p'), ospf: { process: 1 } } as unknown as NetNode;
  const runOn = (line: string, target: NetNode, session: TerminalSession) =>
    runLine(line, commandContextOf({ node: target, nodes: [], links: [], data: {} as EngineData, state: {} as NetworkState }, false, session), tr);

  it('no router ospf の番号が違うときは外さず、誤りを返す。番号が合えば外す', () => {
    expect(runOn('no router ospf 2', withProcess, config).lines).toEqual([{ text: 'ui.terminal.ospfProcessMismatch', kind: 'err' }]);
    expect(runOn('no router ospf 1', withProcess, config).change).toEqual({ kind: 'routing', change: { proto: 'ospf', on: false, process: null } });
  });

  it('router ospf <n> は番号を書き、show running-config に出す（番号がなければ出さない）', () => {
    expect(run('router ospf 7', config).change).toEqual({ kind: 'routing', change: { proto: 'ospf', on: true, process: 7 } });
    expect(runOn('show running-config', withProcess, exec).lines).toContainEqual({ text: 'ui.terminal.cfgOspf', kind: 'out' });
    expect(runOn('show running-config', node('l2_switch_8p'), exec).lines).not.toContainEqual({ text: 'ui.terminal.cfgOspf', kind: 'out' });
  });
});
