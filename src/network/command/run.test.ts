import { describe, expect, it } from 'vitest';
import type { EngineData, NetNode } from '../types';
import type { NetworkState } from '../engine/state';
import { commandContextOf, runLine } from './run';

const tr = (key: string) => key;
// 読み取り専用の判定の試験に使う機器（経路は1つだけ）
const node = { uid: 'R1', routes: [{ dest: '10.0.1.0', prefix: 24, nextHop: '10.0.0.1' }], interfaces: [], hostname: undefined } as unknown as NetNode;
const ctxOf = (readOnly: boolean) => commandContextOf({ node, nodes: [node], links: [], data: {} as EngineData, state: {} as NetworkState }, readOnly);

describe('読み取り専用の機器の誤り（設定の命令は、構文の検査の後で読み取り専用を返す）', () => {
  it('構文の誤りは、読み取り専用の機器でも使い方の誤りを返す', () => {
    expect(runLine('hostname 1bad', ctxOf(true), tr).lines).toEqual([{ text: 'ui.terminal.errHostname', kind: 'err' }]);
    expect(runLine('ip address 0 10.0.0.1', ctxOf(true), tr).lines).toEqual([{ text: 'ui.terminal.usageIpAddress', kind: 'err' }]);
  });

  it('構文が正しい設定の命令は、読み取り専用の機器では設定を変えず、読み取り専用の誤りを返す', () => {
    const r = runLine('hostname R2', ctxOf(true), tr);
    expect(r.change).toBeNull();
    expect(r.lines).toEqual([{ text: 'ui.terminal.readOnly', kind: 'err' }]);
    expect(runLine('no hostname', ctxOf(true), tr).lines).toEqual([{ text: 'ui.terminal.readOnly', kind: 'err' }]);
  });

  it('存在しない経路の no ip route は、読み取り専用の機器では読み取り専用の誤りを返す', () => {
    expect(runLine('no ip route 10.0.9.0 255.255.255.0', ctxOf(true), tr).lines).toEqual([{ text: 'ui.terminal.readOnly', kind: 'err' }]);
    expect(runLine('no ip route 10.0.9.0 255.255.255.0', ctxOf(false), tr).lines).toEqual([{ text: 'ui.terminal.noRouteToRemove', kind: 'err' }]);
  });

  it('書ける機器では、構文が正しい設定の命令は設定を変える', () => {
    expect(runLine('hostname R2', ctxOf(false), tr).change).toEqual({ kind: 'hostname', hostname: 'R2' });
    expect(runLine('ip address 0 10.0.0.1 255.0.0.0', ctxOf(false), tr).change).toEqual({ kind: 'iface', port: 0, ip: '10.0.0.1', prefix: 8 });
  });
});
