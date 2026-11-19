// マップの右クリック（長押し）のメニューを出す。項目は開いた時点で作って useUiStore が持つ。
import { useCallback } from 'react';
import { tDyn } from '../i18n/t';
import { useUiStore } from '../stores/useUiStore';
import { ContextMenu } from './ui/ContextMenu';

export function ContextMenuLayer() {
  const menu = useUiStore((s) => s.contextMenu);
  const close = useCallback(() => useUiStore.getState().setContextMenu(null), []);
  if (!menu) return null;
  const items = menu.items.map((item) => ({ id: item.id, label: tDyn(item.label), onSelect: item.run }));
  return <ContextMenu x={menu.x} y={menu.y} items={items} onClose={close} />;
}
