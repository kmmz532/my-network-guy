// NAT の設定コマンドの書式（N145・N146）
import { describe, expect, it } from 'vitest';
import type { EngineData, NetNode } from './types';
import type { NetworkState } from './engine/state';
import { commandContextOf, runLine } from './command/run';

const tr = (key: string) => key;
const node = { interfaces: [{ port: 0, id: 'g0/0' }, { port: 1, id: 'g0/1' }] } as NetNode;
const ctx = commandContextOf({ node, nodes: [], links: [], data: {} as EngineData, state: {} as NetworkState }, false);
const viaTree = (line: string) => ({ kind: 'action', action: runLine(line, ctx, tr).change });

describe('NAT の設定コマンド', () => {
  it('ip nat inside・outside は、口の番号を指定する', () => {
    expect(viaTree('ip nat inside 1')).toEqual({ kind: 'action', action: { kind: 'nat', change: { op: 'iface', id: 'g0/1', nat: 'inside' } } });
    expect(viaTree('ip nat outside 0')).toEqual({ kind: 'action', action: { kind: 'nat', change: { op: 'iface', id: 'g0/0', nat: 'outside' } } });
    expect(viaTree('no ip nat 0')).toEqual({ kind: 'action', action: { kind: 'nat', change: { op: 'iface', id: 'g0/0', nat: null } } });
  });

  it('NAPT の有効・無効', () => {
    expect(viaTree('ip nat napt')).toEqual({ kind: 'action', action: { kind: 'nat', change: { op: 'napt', on: true } } });
    expect(viaTree('no ip nat napt')).toEqual({ kind: 'action', action: { kind: 'nat', change: { op: 'napt', on: false } } });
  });

  it('静的 NAT（外のポート → 社内のアドレスとポート）', () => {
    expect(viaTree('ip nat static 80 192.168.1.20 80')).toEqual({ kind: 'action', action: { kind: 'nat', change: { op: 'static', port: 80, insideIp: '192.168.1.20', insidePort: 80 } } });
    expect(viaTree('no ip nat static 80')).toEqual({ kind: 'action', action: { kind: 'nat', change: { op: 'noStatic', port: 80 } } });
  });
});
