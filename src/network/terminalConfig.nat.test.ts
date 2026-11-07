// NAT の設定コマンドの書式（N145・N146）
import { describe, expect, it } from 'vitest';
import { parseConfig } from './terminalConfig';

const tr = (key: string) => key;

describe('NAT の設定コマンド', () => {
  it('ip nat inside・outside は、口の番号を指定する', () => {
    expect(parseConfig('ip nat inside 1', tr)).toEqual({ kind: 'action', action: { kind: 'nat', op: 'iface', port: 1, nat: 'inside' } });
    expect(parseConfig('ip nat outside 0', tr)).toEqual({ kind: 'action', action: { kind: 'nat', op: 'iface', port: 0, nat: 'outside' } });
    expect(parseConfig('no ip nat 0', tr)).toEqual({ kind: 'action', action: { kind: 'nat', op: 'iface', port: 0, nat: null } });
  });

  it('NAPT の有効・無効', () => {
    expect(parseConfig('ip nat napt', tr)).toEqual({ kind: 'action', action: { kind: 'nat', op: 'napt', on: true } });
    expect(parseConfig('no ip nat napt', tr)).toEqual({ kind: 'action', action: { kind: 'nat', op: 'napt', on: false } });
  });

  it('静的 NAT（外のポート → 社内のアドレスとポート）', () => {
    expect(parseConfig('ip nat static 80 192.168.1.20 80', tr)).toEqual({ kind: 'action', action: { kind: 'nat', op: 'static', port: 80, insideIp: '192.168.1.20', insidePort: 80 } });
    expect(parseConfig('no ip nat static 80', tr)).toEqual({ kind: 'action', action: { kind: 'nat', op: 'noStatic', port: 80 } });
  });
});
