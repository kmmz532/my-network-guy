import { describe, expect, it } from 'vitest';
import { COMMANDS } from './registry';
import { LEGACY_ABBREV, parseLine } from './parse';
import type { TerminalSession } from './types';

const exec: TerminalSession = { mode: 'exec', iface: null, process: null };
const config: TerminalSession = { mode: 'config', iface: null, process: null };

describe('命令の解釈', () => {
  it('固定の語がすべて一致する行は、その命令に当てはまる', () => {
    expect(parseLine('show ip route', exec)).toEqual({ spec: COMMANDS.get('static_route.showIpRoute'), args: {} });
    expect(parseLine('show ip', exec)).toEqual({ spec: COMMANDS.get('core.showIp'), args: {} });
  });

  it('{ rest } は残りの語を空白でつないで受け取る。語がなければ空文字', () => {
    expect(parseLine('ping 10.0.0.1', exec)).toEqual({ spec: COMMANDS.get('core.ping'), args: { args: '10.0.0.1' } });
    expect(parseLine('ping', exec)).toEqual({ spec: COMMANDS.get('core.ping'), args: { args: '' } });
  });

  it('語が余る行・足りない行・登録のない行は null を返す', () => {
    expect(parseLine('show ip route extra', exec)).toBeNull();
    expect(parseLine('show', exec)).toBeNull();
    expect(parseLine('ip route 10.0.0.0 255.0.0.0 10.0.0.1', exec)).toBeNull();
    expect(parseLine('', exec)).toBeNull();
  });

  it('命令は、登録されたモードでだけ解釈する', () => {
    expect(parseLine('show ip route', config)).toBeNull();
  });

  it('LEGACY_ABBREV にある語は、一意に決まるとき正式な形へ展開する', () => {
    expect(parseLine('sh ip ro', exec)).toEqual({ spec: COMMANDS.get('static_route.showIpRoute'), args: {} });
    expect(parseLine('sh mac add', exec)).toEqual({ spec: COMMANDS.get('vlan.showMacAddressTable'), args: {} });
    expect(LEGACY_ABBREV.show).toContain('interfaces');
  });

  it('表にない語は展開せず、以降も展開しない', () => {
    expect(parseLine('ping R1', exec)).toEqual({ spec: COMMANDS.get('core.ping'), args: { args: 'R1' } });
    expect(parseLine('ping sh', exec)).toEqual({ spec: COMMANDS.get('core.ping'), args: { args: 'sh' } });
  });

  it('一意に決まらない略記は ambiguous と、その語の位置を返す', () => {
    expect(parseLine('sh i', exec)).toEqual({ error: 'ambiguous', at: 3 });
    expect(parseLine('h', exec)).toEqual({ error: 'ambiguous', at: 0 });
  });
});
