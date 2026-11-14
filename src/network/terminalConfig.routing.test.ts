// RIP・OSPF の設定コマンドの書式（N143）
import { describe, expect, it } from 'vitest';
import { parseConfig } from './terminalConfig';
import type { EngineData, NetNode } from './types';
import type { NetworkState } from './engine/state';
import type { Tr } from './terminal';
import { commandContextOf, runLine } from './command/run';

// 木の命令の結果を、解釈の形（action は設定の操作、error は誤りの鍵）に合わせて見る
const treeCtx = commandContextOf({ node: {} as NetNode, nodes: [], links: [], data: {} as EngineData, state: {} as NetworkState }, false);
const viaTree = (line: string, tr: Tr) => {
  const r = runLine(line, treeCtx, tr);
  return r.change !== null ? { kind: 'action', action: r.change } : { kind: 'error', text: r.lines[0].text };
};

const tr = (key: string) => key;

describe('RIP・OSPF の設定コマンド', () => {
  it('router rip / no router rip', () => {
    expect(viaTree('router rip', tr)).toEqual({ kind: 'action', action: { kind: 'routing', change: { proto: 'rip', on: true } } });
    expect(viaTree('no router rip', tr)).toEqual({ kind: 'action', action: { kind: 'routing', change: { proto: 'rip', on: false } } });
  });

  it('network <IP> は RIP、network <IP> <ワイルドカード> area 0 は OSPF', () => {
    expect(viaTree('network 10.0.1.0', tr)).toEqual({ kind: 'action', action: { kind: 'routing', change: { proto: 'rip', ip: '10.0.1.0', on: true } } });
    expect(viaTree('network 10.0.1.0 0.0.0.255 area 0', tr)).toEqual({ kind: 'action', action: { kind: 'routing', change: { proto: 'ospf', ip: '10.0.1.0', area: 0, on: true } } });
  });

  it('MVP では OSPF のエリアは 0 だけ（ほかは errArea）', () => {
    expect(viaTree('network 10.0.1.0 0.0.0.255 area 1', tr)).toEqual({ kind: 'action', action: { kind: 'routing', change: { proto: 'ospf', ip: '10.0.1.0', area: 1, on: true } } });
  });
  it('OSPF の router-id・既定の経路の配布・インターフェースの設定を読む', () => {
    expect(parseConfig('router-id 1.1.1.1', tr)).toEqual({ kind: 'action', action: { kind: 'ospf', op: 'routerId', ip: '1.1.1.1' } });
    expect(parseConfig('no router-id', tr)).toEqual({ kind: 'action', action: { kind: 'ospf', op: 'routerId', ip: null } });
    expect(parseConfig('default-information originate', tr)).toEqual({ kind: 'action', action: { kind: 'ospf', op: 'defaultOriginate', on: true } });
    expect(parseConfig('no default-information originate', tr)).toEqual({ kind: 'action', action: { kind: 'ospf', op: 'defaultOriginate', on: false } });
    expect(parseConfig('ip ospf hello-interval 1 30', tr)).toEqual({ kind: 'action', action: { kind: 'ospf', op: 'iface', port: 1, key: 'hello', value: 30 } });
    expect(viaTree('network 10.0.1.0 0.0.0.255 area 0.0.0.1', tr)).toEqual({ kind: 'action', action: { kind: 'routing', change: { proto: 'ospf', ip: '10.0.1.0', area: 1, on: true } } });
  });
});

describe('switchport trunk', () => {
  it('trunk の許可する VLAN と native を読む', () => {
    expect(viaTree('switchport 1 trunk', tr)).toEqual({ kind: 'action', action: { kind: 'portMode', port: 1, mode: { kind: 'trunk' } } });
    expect(viaTree('switchport 1 trunk allowed 10,20 native 10', tr)).toEqual({ kind: 'action', action: { kind: 'portMode', port: 1, mode: { kind: 'trunk', allowed: [10, 20], native: 10 } } });
    expect(viaTree('switchport 1 trunk allowed all', tr)).toEqual({ kind: 'action', action: { kind: 'portMode', port: 1, mode: { kind: 'trunk', allowed: null } } });
    expect(viaTree('switchport 1 trunk allowed 0', tr)).toEqual({ kind: 'error', text: 'ui.terminal.errVlan' });
  });
});
