import { describe, expect, it } from 'vitest';
import { COMMANDS } from './registry';
import { parseLine } from './parse';
import type { TerminalSession } from './types';

const exec: TerminalSession = { mode: 'exec', iface: null, process: null };
const config: TerminalSession = { mode: 'config', iface: null, process: null };

describe('命令の解釈', () => {
  it('固定の語がすべて一致する行は、その命令に当てはまる', () => {
    expect(parseLine('show ip route', exec)).toEqual({ spec: COMMANDS.get('static_route.showIpRoute'), args: {} });
    expect(parseLine('show ip', exec)).toEqual({ spec: COMMANDS.get('core.showIp'), args: {} });
  });

  it('宛先の引数は、IP か名前の形の語だけを受け取る', () => {
    expect(parseLine('ping 10.0.0.1', exec)).toEqual({ spec: COMMANDS.get('core.ping'), args: { target: '10.0.0.1' } });
    expect(parseLine('ping sh', exec)).toEqual({ spec: COMMANDS.get('core.ping'), args: { target: 'sh' } });
    expect(parseLine('ping 1.2.3', exec)).toEqual({ error: 'invalid', at: 5 });
    expect(parseLine('ping', exec)).toEqual({ error: 'invalid', at: 5 });
  });

  it('空の行は null を返す。語が余る行・足りない行・登録のない語は、誤りの位置を返す', () => {
    expect(parseLine('', exec)).toBeNull();
    expect(parseLine('show ip route extra', exec)).toEqual({ error: 'invalid', at: 14 });
    expect(parseLine('show', exec)).toEqual({ error: 'invalid', at: 5 });
    expect(parseLine('ip foo', exec)).toEqual({ error: 'invalid', at: 3 });
  });

  it('命令は、登録されたモードでだけ解釈する', () => {
    expect(parseLine('show ip route', config)).toEqual({ error: 'invalid', at: 0 });
  });

  it('固定の語は、その位置で一意に決まるとき正式な形へ展開する', () => {
    expect(parseLine('sh ip ro', exec)).toEqual({ spec: COMMANDS.get('static_route.showIpRoute'), args: {} });
    expect(parseLine('sh mac add', exec)).toEqual({ spec: COMMANDS.get('vlan.showMacAddressTable'), args: {} });
    expect(parseLine('conf t', exec)).toEqual({ spec: COMMANDS.get('core.configureTerminal'), args: {} });
  });

  it('型のある引数は、型に合う語だけを受け取り、合わない語はその位置を誤りにする', () => {
    expect(parseLine('ip rou 10.0.0.0 255.0.0.0 10.1.1.1', exec)).toEqual({
      spec: COMMANDS.get('static_route.ipRoute'),
      args: { dest: '10.0.0.0', mask: '255.0.0.0', nextHop: '10.1.1.1' },
    });
    expect(parseLine('ip route 10.0.0.0 255.0.255.0 10.1.1.1', exec)).toEqual({ error: 'invalid', at: 18 });
    expect(parseLine('ip route 10.0.0.0 255.0.0.0', exec)).toEqual({ error: 'invalid', at: 28 });
    expect(parseLine('no ip default-gateway x', exec)).toEqual({ error: 'invalid', at: 22 });
  });

  it('一意に決まらない略記は ambiguous と、その語の位置を返す', () => {
    expect(parseLine('sh i', exec)).toEqual({ error: 'ambiguous', at: 3 });
    expect(parseLine('h', exec)).toEqual({ error: 'ambiguous', at: 0 });
  });
});
