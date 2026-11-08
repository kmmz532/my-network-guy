// SVI（VLAN のインターフェース）と口のモードの書式（N137・N138）
import { describe, expect, it } from 'vitest';
import { parseConfig } from './terminalConfig';

const tr = (key: string) => key;

describe('SVI と口のモードの設定コマンド（N138）', () => {
  it('ip address vlan で SVI のアドレスを設定し、no ip address vlan で外す', () => {
    expect(parseConfig('ip address vlan 10 192.168.10.1 255.255.255.0', tr)).toEqual({
      kind: 'action',
      action: { kind: 'svi', vlan: 10, ip: '192.168.10.1', prefix: 24 },
    });
    expect(parseConfig('no ip address vlan 10', tr)).toEqual({ kind: 'action', action: { kind: 'svi', vlan: 10, ip: '', prefix: 24 } });
  });

  it('VLAN の番号は 1〜4094 だけ受け付ける', () => {
    expect(parseConfig('ip address vlan 0 192.168.10.1 255.255.255.0', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errVlan' });
    expect(parseConfig('no ip address vlan 4095', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errVlan' });
  });

  it('switchport <口> access vlan <番号> で口を VLAN に入れ、no switchport <口> でルーターの口に戻す', () => {
    expect(parseConfig('switchport 2 access vlan 20', tr)).toEqual({
      kind: 'action',
      action: { kind: 'portMode', port: 2, mode: { kind: 'access', vlan: 20 } },
    });
    expect(parseConfig('no switchport 2', tr)).toEqual({ kind: 'action', action: { kind: 'portMode', port: 2, mode: { kind: 'routed' } } });
  });
});
