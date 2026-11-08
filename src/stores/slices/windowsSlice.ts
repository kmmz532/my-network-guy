// 開いているウィンドウ（機器の画面・社員の札）の状態と操作。位置と大きさは端末ごとに localStorage へ覚える
import type { StateCreator } from 'zustand';
import {
  type Rect,
  type Viewport,
  type WindowItem,
  type WindowKind,
  type WindowMemory,
  closeTab as closeTabOp,
  closeWindow as closeWindowOp,
  fitWindows as fitWindowsOp,
  focusWindow as focusWindowOp,
  frontWindow,
  moveWindow as moveWindowOp,
  openWindow as openWindowOp,
  parseMemory,
  placeWindow as placeWindowOp,
  remember,
  reorderTab as reorderTabOp,
  resizeWindow as resizeWindowOp,
  selectTab as selectTabOp,
  toggleWindow as toggleWindowOp,
} from '../../ui/windows';
import { isPhoneNow } from '../../ui/usePhone';
import type { GameState } from '../useGameStore';

export interface WindowsSlice {
  // 開いているウィンドウ（機器の画面・社員の札）。保存しない。手前ほど z が大きい
  windows: WindowItem[];
  windowSeq: number;
  // 種類ごとに最後に置いた位置と大きさ（localStorage に保存する）
  windowMemory: WindowMemory;
  openWindow: (kind: WindowKind, ref: string) => void;
  toggleWindow: (kind: WindowKind, ref: string) => void;
  closeWindow: (id: number) => void;
  closeTab: (id: number, ref: string) => void;
  // 画面の大きさが変わったとき、開いているウィンドウを画面の中に収める（覚える位置は変えない）
  fitWindows: () => void;
  selectTab: (id: number, ref: string) => void;
  // ウィンドウのタブを並べ替える（from から to の位置へ）
  reorderTab: (id: number, from: number, to: number) => void;
  focusWindow: (id: number) => void;
  moveWindow: (id: number, x: number, y: number) => void;
  resizeWindow: (id: number, w: number, h: number) => void;
  // 位置と大きさを、辺のドラッグの結果のまま置く（N57）
  placeWindow: (id: number, rect: Rect) => void;
}

// 覚えた位置と大きさを保存する場所（端末ごと。セーブデータには入れない）
const MEMORY_KEY = 'network-ya.windows.v1';
const readMemory = (): WindowMemory => {
  try {
    return parseMemory(window.localStorage.getItem(MEMORY_KEY));
  } catch {
    return {};
  }
};
const writeMemory = (memory: WindowMemory): void => {
  try {
    window.localStorage.setItem(MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // 保存できなくても、画面の操作は続けられる
  }
};

const rememberWin = (memory: WindowMemory, windows: WindowItem[], id: number): WindowMemory => {
  const win = windows.find((w) => w.id === id);
  if (!win) return memory;
  const next = remember(memory, win);
  writeMemory(next);
  return next;
};

export const viewportNow = (): Viewport => ({ w: window.innerWidth, h: window.innerHeight, phone: isPhoneNow() });

// 一番手前のウィンドウが機器の画面なら、その選ばれているタブの機器の uid（マップの選択の枠に使う）
export const frontDeviceUid = (s: { windows: WindowItem[] }): string | null => {
  const front = frontWindow(s.windows);
  return front?.kind === 'device' ? front.active : null;
};

export const createWindowsSlice: StateCreator<GameState, [], [], WindowsSlice> = (set, get) => ({
  windows: [],
  windowSeq: 0,
  windowMemory: readMemory(),
  openWindow: (kind, ref) => {
    const s = get();
    const list = openWindowOp({ windows: s.windows, seq: s.windowSeq }, kind, ref, viewportNow(), s.windowMemory);
    set({ windows: list.windows, windowSeq: list.seq });
  },
  toggleWindow: (kind, ref) => {
    const s = get();
    const list = toggleWindowOp({ windows: s.windows, seq: s.windowSeq }, kind, ref, viewportNow(), s.windowMemory);
    set({ windows: list.windows, windowSeq: list.seq });
  },
  closeWindow: (id) => {
    const list = closeWindowOp({ windows: get().windows, seq: get().windowSeq }, id);
    set({ windows: list.windows });
  },
  fitWindows: () => {
    const s = get();
    const list = fitWindowsOp({ windows: s.windows, seq: s.windowSeq }, viewportNow());
    if (list.windows !== s.windows) set({ windows: list.windows });
  },
  closeTab: (id, ref) => {
    const list = closeTabOp({ windows: get().windows, seq: get().windowSeq }, id, ref);
    set({ windows: list.windows });
  },
  selectTab: (id, ref) => {
    const list = selectTabOp({ windows: get().windows, seq: get().windowSeq }, id, ref);
    set({ windows: list.windows });
  },
  reorderTab: (id, from, to) => {
    const list = reorderTabOp({ windows: get().windows, seq: get().windowSeq }, id, from, to);
    set({ windows: list.windows });
  },
  focusWindow: (id) => {
    const list = focusWindowOp({ windows: get().windows, seq: get().windowSeq }, id);
    set({ windows: list.windows });
  },
  moveWindow: (id, x, y) => {
    const s = get();
    const list = moveWindowOp({ windows: s.windows, seq: s.windowSeq }, id, x, y, viewportNow());
    if (list.windows === s.windows) return;
    set({ windows: list.windows, windowMemory: rememberWin(s.windowMemory, list.windows, id) });
  },
  placeWindow: (id, rect) => {
    const s = get();
    const list = placeWindowOp({ windows: s.windows, seq: s.windowSeq }, id, rect, viewportNow());
    if (list.windows === s.windows) return;
    set({ windows: list.windows, windowMemory: rememberWin(s.windowMemory, list.windows, id) });
  },
  resizeWindow: (id, w, h) => {
    const s = get();
    const list = resizeWindowOp({ windows: s.windows, seq: s.windowSeq }, id, w, h, viewportNow());
    if (list.windows === s.windows) return;
    set({ windows: list.windows, windowMemory: rememberWin(s.windowMemory, list.windows, id) });
  },
});
