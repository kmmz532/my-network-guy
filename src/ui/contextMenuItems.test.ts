import { describe, expect, it } from 'vitest';
import type { Operation } from '../company/operation';
import { menuItemsOf, type MenuActions, type NodeFacts } from './contextMenuItems';

const ids = (target: Parameters<typeof menuItemsOf>[0], allowed: Operation['kind'][], node?: Partial<NodeFacts>) =>
  menuItemsOf(target, {
    allows: (op) => allowed.includes(op.kind),
    node: node === undefined ? undefined : { hasConfig: true, hasPower: true, powered: true, name: '', ...node },
  }).map((i) => i.id);

describe('右クリックのメニューの項目', () => {
  const node = { kind: 'node', uid: 'n1' } as const;

  it('機器は、操作が通るものだけを並べる', () => {
    expect(ids(node, ['config', 'duplicateNode', 'removeNode'], {})).toEqual(['settings', 'rename', 'power', 'duplicate', 'remove']);
  });

  it('既設（撤去できない）の機器には撤去が出ない', () => {
    expect(ids(node, ['config', 'duplicateNode'], {})).toEqual(['settings', 'rename', 'power', 'duplicate']);
  });

  it('読み取り専用の場面では、設定を開く以外が出ない', () => {
    expect(ids(node, [], {})).toEqual(['settings']);
  });

  it('設定の欄がない機器（L2 スイッチ）には、名前と電源が出ない', () => {
    expect(ids(node, ['config', 'removeNode'], { hasConfig: false })).toEqual(['settings', 'remove']);
  });

  it('電源を切り替えない機器（回線終端）には電源が出ない', () => {
    expect(ids(node, ['config'], { hasPower: false })).toEqual(['settings', 'rename']);
  });

  it('電源の項目は、いまの状態の逆を示す', () => {
    const on = menuItemsOf(node, { allows: () => true, node: { hasConfig: true, hasPower: true, powered: true, name: '' } });
    const off = menuItemsOf(node, { allows: () => true, node: { hasConfig: true, hasPower: true, powered: false, name: '' } });
    expect(on.find((i) => i.id === 'power')?.label).toBe('ui.cmenu.powerOff');
    expect(off.find((i) => i.id === 'power')?.label).toBe('ui.cmenu.powerOn');
  });

  it('既設の配線（外せない）には項目が出ない', () => {
    expect(ids({ kind: 'link', uid: 'l1' }, [])).toEqual([]);
    expect(ids({ kind: 'link', uid: 'l1' }, ['removeLink'])).toEqual(['unplug']);
  });

  it('家具は、回す・撤去を操作が通るものだけ並べる', () => {
    const furniture = { kind: 'furniture', uid: 'f1' } as const;
    expect(ids(furniture, ['rotateFurniture', 'removeFurniture'])).toEqual(['rotate', 'remove']);
    expect(ids(furniture, ['rotateFurniture'])).toEqual(['rotate']);
    expect(ids(furniture, [])).toEqual([]);
  });

  it('項目は対象の uid で既存の操作を呼ぶ', () => {
    const calls: string[] = [];
    const actions: MenuActions = {
      openSettings: (u) => calls.push(`settings:${u}`),
      setPower: (u, on) => calls.push(`power:${u}:${on}`),
      duplicateNode: (u) => calls.push(`dup:${u}`),
      removeNode: (u) => calls.push(`rm:${u}`),
      removeLink: (u) => calls.push(`unplug:${u}`),
      rotateFurniture: (u) => calls.push(`rot:${u}`),
      removeFurniture: (u) => calls.push(`rmf:${u}`),
    };
    for (const item of menuItemsOf(node, { allows: () => true, node: { hasConfig: true, hasPower: true, powered: true, name: '' } })) item.run(actions);
    expect(calls).toEqual(['settings:n1', 'settings:n1', 'power:n1:false', 'dup:n1', 'rm:n1']);
  });
});
