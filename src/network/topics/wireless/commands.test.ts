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

describe('無線の帯・RADIUS・802.1X の命令', () => {
  it('帯は 2.4GHz・5GHz の語で選び、それ以外の帯は誤りにする', () => {
    expect(viaTree('wireless band 5', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'band', value: '5' } });
    expect(viaTree('wireless band 2.4', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'band', value: '2.4' } });
    expect(viaTree('wireless band 6', tr).kind).toBe('error');
  });

  it('チャネルは、どの帯の番号でも入る（帯で選べるかは設定の検査が決める）', () => {
    expect(viaTree('wireless channel 52', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'channel', value: 52 } });
    expect(viaTree('wireless channel 14', tr).kind).toBe('error');
  });

  it('RADIUS のアドレスを設定し、no で外す', () => {
    expect(viaTree('wireless radius-server 192.168.1.50', tr)).toEqual({
      kind: 'action',
      action: { kind: 'wireless', key: 'radius', value: '192.168.1.50' },
    });
    expect(viaTree('no wireless radius-server', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'radius', value: null } });
  });

  it('802.1X の方式は、既存の綴りに合わせた語で選ぶ', () => {
    expect(viaTree('wireless security wpa2-eap', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'security', value: 'wpa2_eap' } });
    expect(viaTree('wireless security wpa3-eap', tr)).toEqual({ kind: 'action', action: { kind: 'wireless', key: 'security', value: 'wpa3_eap' } });
  });
});
