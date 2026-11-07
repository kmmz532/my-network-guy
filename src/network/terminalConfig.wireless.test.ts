// 無線の設定コマンドの書式（N151）
import { describe, expect, it } from 'vitest';
import { parseConfig } from './terminalConfig';

const tr = (key: string) => key;

describe('無線の設定コマンド', () => {
  it('SSID・パスワード・チャネル・VLAN', () => {
    expect(parseConfig('wireless ssid home', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'ssid', value: 'home' } });
    expect(parseConfig('wireless password pass1234', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'password', value: 'pass1234' } });
    expect(parseConfig('wireless channel 6', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'channel', value: 6 } });
    expect(parseConfig('wireless vlan 10', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'vlan', value: 10 } });
  });

  it('パスワードは8字以上、チャネルは1〜13', () => {
    expect(parseConfig('wireless password short', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageWireless' });
    expect(parseConfig('wireless channel 14', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageWireless' });
  });
});
