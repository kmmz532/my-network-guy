// マップの右クリック（長押し）のメニューの項目の表。対象の種類ごとに、出す項目を決める。
// 項目は既存の操作を呼ぶだけで、押せない項目（ロック中・能力がない・読み取り専用）は並べずに外す。
// 操作が通るかは allows（store の操作と同じ判定）で見るため、規則をここで重ねて持たない。
import type { Operation } from '../company/operation';

export type MenuTarget = { kind: 'node'; uid: string } | { kind: 'link'; uid: string } | { kind: 'furniture'; uid: string } | { kind: 'staff'; uid: string };

// 機器の状態のうち、操作の判定だけでは決まらないもの
export interface NodeFacts {
  // 設定の欄を持つか（L2 スイッチは持たない）
  hasConfig: boolean;
  // 電源を切り替えられる機器か（回線終端は切り替えない）
  hasPower: boolean;
  powered: boolean;
  // いまの名前（未設定は空）
  name: string;
  // 口の一覧を開けるか（機器を編集できる場面）
  canWire: boolean;
}

export interface MenuFacts {
  allows: (op: Operation) => boolean;
  node?: NodeFacts;
  // 家具が効果の範囲を持つか（植物・本棚など）。持つときだけ「効果の範囲」を出す
  furniture?: { hasEffectRange: boolean };
}

// 項目が呼ぶ既存の操作
export interface MenuActions {
  openSettings: (uid: string) => void;
  setPower: (uid: string, on: boolean) => void;
  duplicateNode: (uid: string) => void;
  removeNode: (uid: string) => void;
  removeLink: (uid: string) => void;
  rotateFurniture: (uid: string) => void;
  removeFurniture: (uid: string) => void;
  showEffectRange: (uid: string) => void;
  openStaff: (uid: string) => void;
  openPorts: (uid: string) => void;
}

export interface MenuItem {
  id: 'settings' | 'rename' | 'power' | 'ports' | 'duplicate' | 'remove' | 'unplug' | 'rotate' | 'effectRange' | 'staffInfo';
  // 言語ファイルのキー
  label: string;
  run: (actions: MenuActions) => void;
}

export function menuItemsOf(target: MenuTarget, facts: MenuFacts): MenuItem[] {
  const { uid } = target;
  const items: MenuItem[] = [];
  if (target.kind === 'staff') {
    items.push({ id: 'staffInfo', label: 'ui.cmenu.staffInfo', run: (a) => a.openStaff(uid) });
    return items;
  }
  if (target.kind === 'node') {
    const node = facts.node;
    if (!node) throw new Error('機器の状態が渡されていない');
    const configurable = node.hasConfig && facts.allows({ kind: 'config', uid, change: { kind: 'name', name: node.name } });
    // 設定の欄は、閲覧だけならいつでも開ける
    items.push({ id: 'settings', label: 'ui.cmenu.settings', run: (a) => a.openSettings(uid) });
    if (configurable) items.push({ id: 'rename', label: 'ui.cmenu.rename', run: (a) => a.openSettings(uid) });
    if (node.hasConfig && node.hasPower && facts.allows({ kind: 'config', uid, change: { kind: 'power', on: !node.powered } })) {
      items.push({ id: 'power', label: node.powered ? 'ui.cmenu.powerOff' : 'ui.cmenu.powerOn', run: (a) => a.setPower(uid, !node.powered) });
    }
    if (node.canWire) items.push({ id: 'ports', label: 'ui.cmenu.ports', run: (a) => a.openPorts(uid) });
    if (facts.allows({ kind: 'duplicateNode', uid })) items.push({ id: 'duplicate', label: 'ui.cmenu.duplicate', run: (a) => a.duplicateNode(uid) });
    if (facts.allows({ kind: 'removeNode', uid })) items.push({ id: 'remove', label: 'ui.cmenu.remove', run: (a) => a.removeNode(uid) });
    return items;
  }
  if (target.kind === 'link') {
    if (facts.allows({ kind: 'removeLink', uid })) items.push({ id: 'unplug', label: 'ui.cmenu.unplug', run: (a) => a.removeLink(uid) });
    return items;
  }
  if (facts.furniture?.hasEffectRange) items.push({ id: 'effectRange', label: 'ui.cmenu.effectRange', run: (a) => a.showEffectRange(uid) });
  if (facts.allows({ kind: 'rotateFurniture', uid })) items.push({ id: 'rotate', label: 'ui.cmenu.rotate', run: (a) => a.rotateFurniture(uid) });
  if (facts.allows({ kind: 'removeFurniture', uid })) items.push({ id: 'remove', label: 'ui.cmenu.remove', run: (a) => a.removeFurniture(uid) });
  return items;
}
