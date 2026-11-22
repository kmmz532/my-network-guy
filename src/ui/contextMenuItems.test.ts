import { describe, expect, it } from 'vitest';
import type { Operation } from '../company/operation';
import { menuItemsOf, type MenuActions, type NodeFacts } from './contextMenuItems';

const ids = (target: Parameters<typeof menuItemsOf>[0], allowed: Operation['kind'][], node?: Partial<NodeFacts>) =>
  menuItemsOf(target, {
    allows: (op) => allowed.includes(op.kind),
    node: node === undefined ? undefined : { hasConfig: true, hasPower: true, powered: true, name: '', canWire: true, ...node },
  }).map((i) => i.id);

const noopActions: MenuActions = {
  openSettings: () => undefined,
  setPower: () => undefined,
  duplicateNode: () => undefined,
  removeNode: () => undefined,
  removeLink: () => undefined,
  rotateFurniture: () => undefined,
  removeFurniture: () => undefined,
  showEffectRange: () => undefined,
  openStaff: () => undefined,
  openPorts: () => undefined,
};

describe('右クリックのメニューの項目', () => {
  const node = { kind: 'node', uid: 'n1' } as const;

  it('機器は、操作が通るものだけを並べる', () => {
    expect(ids(node, ['config', 'duplicateNode', 'removeNode'], {})).toEqual(['settings', 'rename', 'power', 'ports', 'duplicate', 'remove']);
  });

  it('既設（撤去できない）の機器には撤去が出ない', () => {
    expect(ids(node, ['config', 'duplicateNode'], {})).toEqual(['settings', 'rename', 'power', 'ports', 'duplicate']);
  });

  it('読み取り専用の場面では、設定を開く以外が出ない', () => {
    expect(ids(node, [], { canWire: false })).toEqual(['settings']);
  });

  it('口の一覧は、機器を編集できる場面だけに出す', () => {
    expect(ids(node, [], { canWire: false, hasConfig: false })).toEqual(['settings']);
    expect(ids(node, [], { canWire: true, hasConfig: false })).toEqual(['settings', 'ports']);
  });

  it('設定の欄がない機器（L2 スイッチ）には、名前と電源が出ない', () => {
    expect(ids(node, ['config', 'removeNode'], { hasConfig: false })).toEqual(['settings', 'ports', 'remove']);
  });

  it('電源を切り替えない機器（回線終端）には電源が出ない', () => {
    expect(ids(node, ['config'], { hasPower: false })).toEqual(['settings', 'rename', 'ports']);
  });

  it('電源の項目は、いまの状態の逆を示す', () => {
    const on = menuItemsOf(node, { allows: () => true, node: { hasConfig: true, hasPower: true, powered: true, name: '', canWire: true } });
    const off = menuItemsOf(node, { allows: () => true, node: { hasConfig: true, hasPower: true, powered: false, name: '', canWire: true } });
    expect(on.find((i) => i.id === 'power')?.label).toBe('ui.cmenu.powerOff');
    expect(off.find((i) => i.id === 'power')?.label).toBe('ui.cmenu.powerOn');
  });

  it('社員は、情報を見る項目だけを出す（読み取り専用でも出る）', () => {
    const staff = { kind: 'staff', uid: 's1' } as const;
    expect(ids(staff, [])).toEqual(['staffInfo']);
    const calls: string[] = [];
    for (const item of menuItemsOf(staff, { allows: () => false })) item.run({ ...noopActions, openStaff: (u) => calls.push(`staff:${u}`) });
    expect(calls).toEqual(['staff:s1']);
  });

  it('既設の配線（外せない）には項目が出ない', () => {
    expect(ids({ kind: 'link', uid: 'l1' }, [])).toEqual([]);
    expect(ids({ kind: 'link', uid: 'l1' }, ['removeLink'])).toEqual(['unplug']);
  });

  it('家具は、編集できるときに回すを並べ、撤去は操作が通るときだけ並べる（回せない理由は回す操作が知らせる）', () => {
    const furniture = { kind: 'furniture', uid: 'f1' } as const;
    const menu = (rotatable: boolean, allowed: Operation['kind'][]) =>
      menuItemsOf(furniture, { allows: (op) => allowed.includes(op.kind), furniture: { hasEffectRange: false, rotatable } }).map((i) => i.id);
    expect(menu(true, ['removeFurniture'])).toEqual(['rotate', 'remove']);
    expect(menu(true, [])).toEqual(['rotate']);
    expect(menu(false, ['removeFurniture'])).toEqual(['remove']);
  });

  it('効果の範囲は、範囲を持つ家具だけに出し、回すより前に並ぶ', () => {
    const furniture = { kind: 'furniture', uid: 'f1' } as const;
    const all = { allows: () => true, furniture: { hasEffectRange: true, rotatable: true } };
    expect(menuItemsOf(furniture, all).map((i) => i.id)).toEqual(['effectRange', 'rotate', 'remove']);
    expect(menuItemsOf(furniture, { allows: () => true, furniture: { hasEffectRange: false, rotatable: true } }).map((i) => i.id)).toEqual(['rotate', 'remove']);
  });

  it('項目は対象の uid で既存の操作を呼ぶ', () => {
    const calls: string[] = [];
    const actions: MenuActions = {
      ...noopActions,
      openSettings: (u) => calls.push(`settings:${u}`),
      openPorts: (u) => calls.push(`ports:${u}`),
      setPower: (u, on) => calls.push(`power:${u}:${on}`),
      duplicateNode: (u) => calls.push(`dup:${u}`),
      removeNode: (u) => calls.push(`rm:${u}`),
      removeLink: (u) => calls.push(`unplug:${u}`),
      rotateFurniture: (u) => calls.push(`rot:${u}`),
      removeFurniture: (u) => calls.push(`rmf:${u}`),
      showEffectRange: (u) => calls.push(`range:${u}`),
    };
    for (const item of menuItemsOf(node, { allows: () => true, node: { hasConfig: true, hasPower: true, powered: true, name: '', canWire: true } })) item.run(actions);
    expect(calls).toEqual(['settings:n1', 'settings:n1', 'power:n1:false', 'ports:n1', 'dup:n1', 'rm:n1']);
  });
});
