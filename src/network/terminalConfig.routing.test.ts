// RIP・OSPF の設定コマンドの書式（N143）
import { describe, expect, it } from 'vitest';
import { parseConfig } from './terminalConfig';

const tr = (key: string) => key;

describe('RIP・OSPF の設定コマンド', () => {
  it('router rip / no router rip', () => {
    expect(parseConfig('router rip', tr)).toEqual({ kind: 'action', action: { kind: 'routing', proto: 'rip', on: true } });
    expect(parseConfig('no router rip', tr)).toEqual({ kind: 'action', action: { kind: 'routing', proto: 'rip', on: false } });
  });

  it('network <IP> は RIP、network <IP> <ワイルドカード> area 0 は OSPF', () => {
    expect(parseConfig('network 10.0.1.0', tr)).toEqual({ kind: 'action', action: { kind: 'network', proto: 'rip', ip: '10.0.1.0', area: null, on: true } });
    expect(parseConfig('network 10.0.1.0 0.0.0.255 area 0', tr)).toEqual({ kind: 'action', action: { kind: 'network', proto: 'ospf', ip: '10.0.1.0', area: 0, on: true } });
  });

  it('MVP では OSPF のエリアは 0 だけ（ほかは errArea）', () => {
    expect(parseConfig('network 10.0.1.0 0.0.0.255 area 1', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errArea' });
  });
});
