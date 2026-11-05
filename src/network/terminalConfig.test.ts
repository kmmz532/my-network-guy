import { describe, expect, it } from 'vitest';
import { isIp, maskToPrefix, parseConfig } from './terminalConfig';

const tr = (key: string) => key;

describe('マスクと IP の判定', () => {
  it('点区切りのマスクをプレフィックス長に直す。連続していないマスクは null', () => {
    expect(maskToPrefix('255.255.255.0')).toBe(24);
    expect(maskToPrefix('255.255.0.0')).toBe(16);
    expect(maskToPrefix('255.255.255.255')).toBe(32);
    expect(maskToPrefix('0.0.0.0')).toBe(0);
    expect(maskToPrefix('255.0.255.0')).toBeNull();
    expect(maskToPrefix('24')).toBeNull();
  });

  it('IP の形と範囲を判定する', () => {
    expect(isIp('192.168.1.10')).toBe(true);
    expect(isIp('192.168.1.256')).toBe(false);
    expect(isIp('192.168.1')).toBe(false);
  });
});

describe('設定のコマンド（段階3）', () => {
  it('ip address は、ポート・IP・マスクを操作にする', () => {
    expect(parseConfig('ip address 0 192.168.1.10 255.255.255.0', tr)).toEqual({
      kind: 'action',
      action: { kind: 'iface', port: 0, ip: '192.168.1.10', prefix: 24 },
    });
  });

  it('ip default-gateway と no ip default-gateway', () => {
    expect(parseConfig('ip default-gateway 192.168.1.1', tr)).toEqual({ kind: 'action', action: { kind: 'gateway', gateway: '192.168.1.1' } });
    expect(parseConfig('no ip default-gateway', tr)).toEqual({ kind: 'action', action: { kind: 'gateway', gateway: null } });
  });

  it('ip route と no ip route', () => {
    expect(parseConfig('ip route 192.168.2.0 255.255.255.0 192.168.1.254', tr)).toEqual({
      kind: 'action',
      action: { kind: 'addRoute', route: { dest: '192.168.2.0', prefix: 24, nextHop: '192.168.1.254' } },
    });
    expect(parseConfig('no ip route 192.168.2.0 255.255.255.0', tr)).toEqual({
      kind: 'action',
      action: { kind: 'removeRoute', dest: '192.168.2.0', prefix: 24 },
    });
  });

  it('形の違う入力は、理由のキーを出す', () => {
    expect(parseConfig('ip address x 192.168.1.10 255.255.255.0', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errPort' });
    expect(parseConfig('ip address 0 192.168.1.999 255.255.255.0', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errIp' });
    expect(parseConfig('ip address 0 192.168.1.10 255.0.255.0', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errMask' });
    expect(parseConfig('ip address 0', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageIpAddress' });
    expect(parseConfig('ip foo', tr)).toEqual({ kind: 'error', text: 'ui.terminal.unknown' });
  });

  it('設定のコマンドでなければ none を返す（確認のコマンドに任せる）', () => {
    expect(parseConfig('show ip', tr)).toEqual({ kind: 'none' });
    expect(parseConfig('ping 192.168.1.11', tr)).toEqual({ kind: 'none' });
  });
});

describe('hostname', () => {
  it('hostname は名前を付け、no hostname は既定の名前に戻す', () => {
    expect(parseConfig('hostname R1', tr)).toEqual({ kind: 'action', action: { kind: 'name', name: 'R1' } });
    expect(parseConfig('no hostname', tr)).toEqual({ kind: 'action', action: { kind: 'name', name: null } });
  });

  it('使えない名前は理由のキーを出す', () => {
    expect(parseConfig('hostname 日本語', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errHostname' });
    expect(parseConfig('hostname abcdefghijklmnopq', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errHostname' });
    expect(parseConfig('hostname', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageHostname' });
  });
});

describe('対応表（ip host）', () => {
  it('ip host は名前と IP を登録し、no ip host は名前を消す', () => {
    expect(parseConfig('ip host R1 192.168.1.1', tr)).toEqual({ kind: 'action', action: { kind: 'host', name: 'R1', ip: '192.168.1.1' } });
    expect(parseConfig('no ip host R1', tr)).toEqual({ kind: 'action', action: { kind: 'noHost', name: 'R1' } });
  });

  it('形の違う入力は理由のキーを出す', () => {
    expect(parseConfig('ip host R1', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageHost' });
    expect(parseConfig('ip host 日本 192.168.1.1', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errHostname' });
    expect(parseConfig('ip host R1 192.168.1.999', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errIp' });
    expect(parseConfig('no ip host', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageNoHost' });
  });
});
