import { describe, expect, it } from 'vitest';
import { isIp, maskToPrefix } from './args';
import type { EngineData, NetNode } from '../types';
import type { NetworkState } from '../engine/state';
import type { Tr } from '../terminal';
import { commandContextOf, runLine } from './run';

// 木の命令の結果を、解釈の形（action は設定の操作、error は誤りの鍵）に合わせて見る
const treeCtx = commandContextOf({ node: {} as NetNode, nodes: [], links: [], data: {} as EngineData, state: {} as NetworkState }, false);
const viaTree = (line: string, tr: Tr) => {
  const r = runLine(line, treeCtx, tr);
  return r.change !== null ? { kind: 'action', action: r.change } : { kind: 'error', text: r.lines[0].text };
};

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
    expect(viaTree('ip address 0 192.168.1.10 255.255.255.0', tr)).toEqual({
      kind: 'action',
      action: { kind: 'iface', port: 0, ip: '192.168.1.10', prefix: 24 },
    });
  });

  it('ip default-gateway と no ip default-gateway', () => {
    expect(viaTree('ip default-gateway 192.168.1.1', tr)).toEqual({ kind: 'action', action: { kind: 'gateway', gateway: '192.168.1.1' } });
    expect(viaTree('no ip default-gateway', tr)).toEqual({ kind: 'action', action: { kind: 'gateway', gateway: null } });
  });

  it('ip route と no ip route', () => {
    expect(viaTree('ip route 192.168.2.0 255.255.255.0 192.168.1.254', tr)).toEqual({
      kind: 'action',
      action: { kind: 'addRoute', route: { dest: '192.168.2.0', prefix: 24, nextHop: '192.168.1.254' } },
    });
    // 消す経路は、機器の経路の表の位置で指す
    const withRoute = commandContextOf({ node: { routes: [{ dest: '192.168.2.0', prefix: 24, nextHop: '192.168.1.254' }] } as NetNode, nodes: [], links: [], data: {} as EngineData, state: {} as NetworkState }, false);
    expect(runLine('no ip route 192.168.2.0 255.255.255.0', withRoute, tr).change).toEqual({ kind: 'removeRoute', index: 0 });
  });

  it('形の違う入力は、理由のキーを出す', () => {
    expect(viaTree('ip address x 192.168.1.10 255.255.255.0', tr)).toEqual({ kind: 'error', text: '             ^' });
    expect(viaTree('ip address 0 192.168.1.999 255.255.255.0', tr)).toEqual({ kind: 'error', text: '               ^' });
    expect(viaTree('ip address 0 192.168.1.10 255.0.255.0', tr)).toEqual({ kind: 'error', text: '                            ^' });
    expect(viaTree('ip address 0', tr)).toEqual({ kind: 'error', text: '               ^' });
    expect(viaTree('ip foo', tr)).toEqual({ kind: 'error', text: '     ^' });
  });

});

describe('hostname', () => {
  it('hostname は名前を付け、no hostname は既定の名前に戻す', () => {
    expect(viaTree('hostname R1', tr)).toEqual({ kind: 'action', action: { kind: 'hostname', hostname: 'R1' } });
    expect(viaTree('no hostname', tr)).toEqual({ kind: 'action', action: { kind: 'hostname', hostname: null } });
  });

  it('使えない名前は理由のキーを出す', () => {
    expect(viaTree('hostname 日本語', tr)).toEqual({ kind: 'error', text: '           ^' });
    expect(viaTree('hostname ' + 'a'.repeat(64), tr)).toEqual({ kind: 'error', text: '           ^' });
    expect(viaTree('hostname 1pc', tr)).toEqual({ kind: 'error', text: '           ^' });
    expect(viaTree('hostname', tr)).toEqual({ kind: 'error', text: '           ^' });
  });
});

describe('対応表（ip host）', () => {
  it('ip host は名前と IP を登録し、no ip host は名前を消す', () => {
    expect(viaTree('ip host R1 192.168.1.1', tr)).toEqual({ kind: 'action', action: { kind: 'host', name: 'R1', ip: '192.168.1.1' } });
    expect(viaTree('no ip host R1', tr)).toEqual({ kind: 'action', action: { kind: 'removeHost', name: 'R1' } });
  });

  it('形の違う入力は理由のキーを出す', () => {
    expect(viaTree('ip host R1', tr)).toEqual({ kind: 'error', text: '             ^' });
    expect(viaTree('ip host 日本 192.168.1.1', tr)).toEqual({ kind: 'error', text: '          ^' });
    expect(viaTree('ip host R1 192.168.1.999', tr)).toEqual({ kind: 'error', text: '             ^' });
    expect(viaTree('no ip host', tr)).toEqual({ kind: 'error', text: '             ^' });
  });
});
