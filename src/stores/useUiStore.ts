// 画面で開いている物（採用の画面・ポップアップ・スマホのインベントリの帯）と、画面の一時の状態（配線の途中・ドラッグ・光の表示）。
// どの層からも開け閉めできるよう、React の外に持つ。ウィンドウ（機器・社員・依頼など）は useGameStore が持つ。
import { create } from 'zustand';

export type HiringTab = 'hiring' | 'staff';

export type Popup = 'menu' | 'help' | 'settings' | 'sandboxResize' | 'sandboxReset' | 'sandboxResetConfirm' | 'lessons';

// 配線の起点（ポートを選んだ機器）。null は「おまかせ」
export interface WireStart {
  uid: string;
  port: number | null;
}

// ポートの一覧の吹き出し。画面上の位置（ビューポートの座標）。role は起点を選ぶ（from）か、相手を選ぶ（to）か、持ったケーブルの端を差す口を選ぶ（drag）
export interface PortMenuState {
  uid: string;
  x: number;
  y: number;
  role: 'from' | 'to' | 'drag';
  // drag（ケーブルの端を持ったまま機器の上に出した一覧）のとき、差せない口の番号と、指・カーソルの下の行（口の番号、おまかせは auto）
  blocked: readonly number[];
  hot: number | 'auto' | null;
}

// 右クリック（長押し）のメニュー。位置は画面の座標。項目は開いた時点の状態から作る（保存しない）
export interface ContextMenuState {
  x: number;
  y: number;
  items: readonly { id: string; label: string; run: () => void }[];
}

// インベントリの欄からドラッグ中の品目と、画面の位置（クライアントの座標）。保存しない
export interface ItemDrag {
  id: string;
  x: number;
  y: number;
}

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
  // パケットの中身の欄で選んでいる通信と区間（hop）。マップのパケットをその区間の位置で止める。欄を閉じたら null（保存しない）
  frameView: { trace: number; hop: number } | null;
  setFrameView: (view: { trace: number; hop: number } | null) => void;
  // 配線の途中の起点（ポートを選んだ機器）と、ポートの一覧の吹き出し（保存しない）
  wireStart: WireStart | null;
  portMenu: PortMenuState | null;
  // マップの右クリック（長押し）のメニュー
  contextMenu: ContextMenuState | null;
  setContextMenu: (menu: ContextMenuState | null) => void;
  // 効果の範囲を見る家具（メニューの「効果の範囲」で選ぶ。マップの押下で外す）。保存しない
  furnitureRange: string | null;
  setFurnitureRange: (uid: string | null) => void;
  // 機器の画面で開く欄の要求（メニューの「設定を開く」）。開いたあとに消す
  deviceTabRequest: { uid: string; tab: 'config' } | null;
  setDeviceTabRequest: (request: { uid: string; tab: 'config' } | null) => void;
  // インベントリの欄から品目をドラッグしている間の位置（保存しない）
  itemDrag: ItemDrag | null;
  // 失敗した操作の理由を、失敗した地点（マップのタイル）に出す（保存しない）
  flash: { key: string; tx: number; ty: number; at: number } | null;
  // 直近につないだ2つの機器と時刻。つながった瞬間に、ケーブルの上を光が走らせる（画面だけの表示。保存しない）
  linkPulse: { a: string; b: string; at: number } | null;
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
  frameView: null,
  setFrameView: (view) => set({ frameView: view }),
  wireStart: null,
  portMenu: null,
  contextMenu: null,
  setContextMenu: (menu) => set({ contextMenu: menu }),
  furnitureRange: null,
  setFurnitureRange: (uid) => set({ furnitureRange: uid }),
  deviceTabRequest: null,
  setDeviceTabRequest: (request) => set({ deviceTabRequest: request }),
  itemDrag: null,
  flash: null,
  linkPulse: null,
}));
