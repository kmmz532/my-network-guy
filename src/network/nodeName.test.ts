import { describe, expect, it } from 'vitest';
import { nodeName, renameNode, type NameContext } from './nodeName';
import type { NetNode } from './types';

const node = (uid: string, device: string, x = 0, y = 0, name?: string): NetNode => ({
  uid,
  device,
  x,
  y,
  locked: false,
  configLocked: false,
  interfaces: [],
  gateway: null,
  routes: [],
  services: [],
  ...(name ? { name } : {}),
});

const CATEGORY: Record<string, string> = { pc_basic: 'pc', server_basic: 'server', l2_switch_8p: 'l2_switch' };
const LABEL: Record<string, string> = { pc: 'PC', server: 'サーバー', l2_switch: 'スイッチ' };
const ctx = (owners: Record<string, string> = {}): NameContext => ({
  categoryOf: (d) => CATEGORY[d] ?? 'unknown',
  categoryLabel: (c) => LABEL[c] ?? c,
  ownedPc: (owner) => `${owner}のPC`,
  ownerAt: (x, y) => owners[`${x},${y}`] ?? null,
});

describe('機器の名前', () => {
  const nodes = [node('a', 'pc_basic', 1, 1), node('b', 'server_basic'), node('c', 'pc_basic', 2, 1), node('d', 'l2_switch_8p')];

  it('座る社員がいないPCは、種類ごとの番号で呼ぶ', () => {
    expect(nodeName(nodes[0], nodes, ctx())).toBe('PC-1');
    expect(nodeName(nodes[2], nodes, ctx())).toBe('PC-2');
  });

  it('座る社員がいるPCは「{社員名}のPC」', () => {
    expect(nodeName(nodes[2], nodes, ctx({ '2,1': '田中' }))).toBe('田中のPC');
  });

  it('PC以外は、社員がいても種類ごとの番号で呼ぶ', () => {
    expect(nodeName(nodes[1], nodes, ctx({ '0,0': '田中' }))).toBe('サーバー-1');
    expect(nodeName(nodes[3], nodes, ctx())).toBe('スイッチ-1');
  });

  it('手で付けた名前があれば、それを使う', () => {
    const named = node('e', 'pc_basic', 1, 1, '受付');
    expect(nodeName(named, [named], ctx({ '1,1': '田中' }))).toBe('受付');
  });

  it('名前を空にすると、既定の名前に戻る', () => {
    const renamed = renameNode(node('e', 'pc_basic', 0, 0, '受付'), '  ');
    expect(renamed.name).toBeUndefined();
    expect(nodeName(renamed, [renamed], ctx())).toBe('PC-1');
  });

  it('名前は前後の空白を除き、24文字までにする', () => {
    expect(renameNode(node('e', 'pc_basic'), '  共有 ').name).toBe('共有');
    expect(renameNode(node('e', 'pc_basic'), 'あ'.repeat(30)).name).toHaveLength(24);
  });
});
