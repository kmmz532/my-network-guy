import { describe, expect, it } from 'vitest';
import type { EngineData, NetNode } from '../../types';
import type { NetworkState } from '../../engine/state';
import type { Tr } from '../../terminal';
import { commandContextOf, runLine } from '../../command/run';

// 木の命令の結果を、解釈の形（action は設定の操作、error は誤りの鍵）に合わせて見る
const treeCtx = commandContextOf({ node: {} as NetNode, nodes: [], links: [], data: {} as EngineData, state: {} as NetworkState }, false);
const viaTree = (line: string, tr: Tr) => {
  const r = runLine(line, treeCtx, tr);
  return r.change !== null ? { kind: 'action', action: r.change } : { kind: 'error', text: r.lines[0].text };
};

const tr = (key: string) => key;

describe('DNS の記録と転送先の命令', () => {
  it('種類と名前と値で記録を入れ、pref は MX の優先度として入る', () => {
    expect(viaTree('ip dns record A www 192.168.1.10', tr)).toEqual({
      kind: 'action',
      action: { kind: 'dnsRecord', record: { type: 'A', name: 'www', value: '192.168.1.10' } },
    });
    expect(viaTree('ip dns record mx example mail.example', tr)).toEqual({
      kind: 'action',
      action: { kind: 'dnsRecord', record: { type: 'MX', name: 'example', value: 'mail.example' } },
    });
    expect(viaTree('ip dns record MX example mail.example 10', tr)).toEqual({
      kind: 'action',
      action: { kind: 'dnsRecord', record: { type: 'MX', name: 'example', value: 'mail.example', pref: 10 } },
    });
  });

  it('種類に合わない値（A に名前など）と、知らない種類は誤りにする', () => {
    expect(viaTree('ip dns record A www not-an-ip', tr)).toEqual({ kind: 'error', text: 'ui.terminal.dnsBadValue' });
    expect(viaTree('ip dns record TXT www hello', tr)).toEqual({ kind: 'error', text: 'ui.terminal.dnsBadType' });
  });

  it('役割と転送先は、権威・キャッシュ・転送先の操作になる', () => {
    expect(viaTree('ip dns server', tr)).toEqual({ kind: 'action', action: { kind: 'dnsRole', on: true, role: 'auth' } });
    expect(viaTree('ip dns server cache', tr)).toEqual({ kind: 'action', action: { kind: 'dnsRole', on: true, role: 'cache' } });
    expect(viaTree('ip dns forwarder 203.0.113.53', tr)).toEqual({ kind: 'action', action: { kind: 'dnsForwarder', ip: '203.0.113.53' } });
    expect(viaTree('no ip dns forwarder', tr)).toEqual({ kind: 'action', action: { kind: 'dnsForwarder', ip: null } });
  });
});
