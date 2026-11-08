// インベントリの開け閉め。スマホは帯（useUiStore）、パソコンはウィンドウ（useGameStore）で持つ。
// 両者の違いはこのファイルだけが知っている。呼ぶ側はスマホかパソコンかを分けない。
import { useGameStore } from '../stores/useGameStore';
import { useUiStore } from '../stores/useUiStore';
import { isPhoneNow, usePhone } from './usePhone';

const windowOpen = (): boolean => useGameStore.getState().windows.some((w) => w.kind === 'inventory');

export function useInventoryOpen(): boolean {
  const phone = usePhone();
  const strip = useUiStore((s) => s.inventoryStrip);
  const win = useGameStore((s) => s.windows.some((w) => w.kind === 'inventory'));
  return phone ? strip : win;
}

export function setInventoryOpen(open: boolean): void {
  if (isPhoneNow()) useUiStore.getState().setInventoryStrip(open);
  else if (open !== windowOpen()) useGameStore.getState().toggleWindow('inventory', '');
}

export function toggleInventory(): void {
  if (isPhoneNow()) useUiStore.getState().setInventoryStrip(!useUiStore.getState().inventoryStrip);
  else useGameStore.getState().toggleWindow('inventory', '');
}
