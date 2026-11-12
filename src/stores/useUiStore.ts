// 画面で開いている物（採用の画面・ポップアップ・スマホのインベントリの帯）。
// どの層からも開け閉めできるよう、React の外に持つ。ウィンドウ（機器・社員・依頼など）は useGameStore が持つ。
import { create } from 'zustand';

export type HiringTab = 'hiring' | 'staff';

export type Popup = 'menu' | 'help' | 'settings' | 'sandboxResize' | 'sandboxReset' | 'sandboxResetConfirm' | 'lessons';

interface UiState {
  // 開いている採用の画面のタブ（閉じていれば null）
  hiring: HiringTab | null;
  openHiring: (tab: HiringTab) => void;
  // ツールバーの採用のボタン。閉じていれば採用のタブで開き、開いていれば閉じる
  toggleHiring: () => void;
  setHiringTab: (tab: HiringTab) => void;
  closeHiring: () => void;
  // 開いているポップアップ（なければ null）
  popup: Popup | null;
  setPopup: (popup: Popup | null) => void;
  // 同じものが開いていれば閉じる
  togglePopup: (popup: Popup) => void;
  // スマホのインベントリの帯が開いているか。パソコンのインベントリはウィンドウ（useGameStore）で持つ
  inventoryStrip: boolean;
  setInventoryStrip: (open: boolean) => void;
}

export const useUiStore = create<UiState>((set) => ({
  hiring: null,
  openHiring: (tab) => set({ hiring: tab }),
  toggleHiring: () => set((s) => ({ hiring: s.hiring === null ? 'hiring' : null })),
  setHiringTab: (tab) => set({ hiring: tab }),
  closeHiring: () => set({ hiring: null }),
  popup: null,
  setPopup: (popup) => set({ popup }),
  togglePopup: (popup) => set((s) => ({ popup: s.popup === popup ? null : popup })),
  inventoryStrip: false,
  setInventoryStrip: (open) => set({ inventoryStrip: open }),
}));
