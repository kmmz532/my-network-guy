// 無線の設定コマンドの書式（N151）
import { describe, expect, it } from 'vitest';
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

describe('無線の設定コマンド', () => {
  it('SSID・パスワード・チャネル・VLAN', () => {
    expect(viaTree('wireless ssid home', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'ssid', value: 'home' } });
    expect(viaTree('wireless password pass1234', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'password', value: 'pass1234' } });
    expect(viaTree('wireless channel 6', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'channel', value: 6 } });
    expect(viaTree('wireless vlan 10', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'vlan', value: 10 } });
  });

  it('パスワードは8字以上、チャネルは1〜13', () => {
    expect(viaTree('wireless password short', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageWireless' });
    expect(viaTree('wireless channel 14', tr)).toEqual({ kind: 'error', text: 'ui.terminal.usageWireless' });
  });
});
