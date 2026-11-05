// 開いているウィンドウの一覧を操作する純粋関数。画面の大きさ（vp）と、種類ごとに覚えた位置・大きさ（memory）は引数で受け取る。
// 押したときの描き方（ポインターの処理）は components/Window.tsx、保存と読み込みは stores/useGameStore.ts が受け持つ。

// ウィンドウの種類。機器の画面・社員の札・社員の一覧
export type WindowKind = 'device' | 'staff' | 'staffList';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowItem extends Rect {
  id: number;
  kind: WindowKind;
  // 機器なら機器の uid、社員なら社員の uid
  ref: string;
  // 重なりの順（大きいほど手前）
  z: number;
}

export interface Viewport {
  w: number;
  h: number;
}

// 種類ごとに最後に置いた位置と大きさ
export type WindowMemory = Partial<Record<WindowKind, Rect>>;

// ウィンドウの一覧と、次に使う id
export interface WindowList {
  windows: WindowItem[];
  seq: number;
}

export const MAX_WINDOWS = 6;
export const MIN_W = 240;
export const MIN_H = 160;
// 新しいウィンドウを前のものからずらす量
export const CASCADE_PX = 24;
// これより狭い画面では、移動と大きさの変更をせず、画面の下に1つだけ出す
export const NARROW_PX = 768;
export const NARROW_HEIGHT_RATIO = 0.4;
// 狭い画面で下に出すとき、ツールバーのために空けておく高さ
export const NARROW_BOTTOM_RESERVE = 64;

const DEFAULT_SIZE: Record<WindowKind, { w: number; h: number }> = {
  device: { w: 300, h: 360 },
  staff: { w: 300, h: 360 },
  staffList: { w: 420, h: 360 },
};
// 初めて開くときの位置（右上。上端は画面の上の欄の下）
const DEFAULT_TOP = 44;
const DEFAULT_RIGHT = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

export const isNarrow = (vp: Viewport): boolean => vp.w < NARROW_PX;

// 画面の外に出ないように、大きさを最小から画面までに収め、位置を画面の中に寄せる
export function clampRect(r: Rect, vp: Viewport): Rect {
  const w = clamp(r.w, MIN_W, vp.w);
  const h = clamp(r.h, MIN_H, vp.h);
  return { x: clamp(r.x, 0, vp.w - w), y: clamp(r.y, 0, vp.h - h), w, h };
}

// 狭い画面で下に1つだけ出すときの位置と大きさ（幅は画面いっぱい、高さは画面の 40%）
export function narrowRect(vp: Viewport): Rect {
  const h = Math.round(vp.h * NARROW_HEIGHT_RATIO);
  return { x: 0, y: Math.max(0, vp.h - NARROW_BOTTOM_RESERVE - h), w: vp.w, h };
}

// 種類の初期の位置と大きさ。覚えた位置があればそれを使う
export function defaultRect(kind: WindowKind, vp: Viewport, memory: WindowMemory): Rect {
  const remembered = memory[kind];
  if (remembered) return clampRect(remembered, vp);
  const size = DEFAULT_SIZE[kind];
  return clampRect({ x: vp.w - size.w - DEFAULT_RIGHT, y: DEFAULT_TOP, w: size.w, h: size.h }, vp);
}

// 新しいウィンドウの位置。一番新しいウィンドウから CASCADE_PX ずらす。画面の外に出る方向は、端に戻して続ける
function placeNew(windows: WindowItem[], kind: WindowKind, vp: Viewport, memory: WindowMemory): Rect {
  const base = defaultRect(kind, vp, memory);
  const newest = windows.reduce<WindowItem | null>((a, w) => (a === null || w.id > a.id ? w : a), null);
  if (newest === null) return base;
  const x = newest.x + CASCADE_PX;
  const y = newest.y + CASCADE_PX;
  return clampRect(
    { x: x + base.w <= vp.w ? x : DEFAULT_RIGHT, y: y + base.h <= vp.h ? y : DEFAULT_TOP, w: base.w, h: base.h },
    vp,
  );
}

const maxZ = (windows: WindowItem[]): number => windows.reduce((m, w) => Math.max(m, w.z), 0);

// 一番手前のウィンドウ（なければ null）
export function frontWindow(windows: WindowItem[]): WindowItem | null {
  return windows.reduce<WindowItem | null>((a, w) => (a === null || w.z > a.z ? w : a), null);
}

// ウィンドウを手前に出す。すでに一番手前なら同じ一覧を返す
export function focusWindow(list: WindowList, id: number): WindowList {
  const target = list.windows.find((w) => w.id === id);
  if (!target || target.z === maxZ(list.windows)) return list;
  const z = maxZ(list.windows) + 1;
  return { ...list, windows: list.windows.map((w) => (w.id === id ? { ...w, z } : w)) };
}

// ウィンドウを開く。同じ種類と ref が開いていれば、新しく開かずに手前に出す。
// 最大数を超えるときは、一番古い（id の小さい）ウィンドウを閉じる。狭い画面では、ほかを閉じて1つだけ出す
export function openWindow(list: WindowList, kind: WindowKind, ref: string, vp: Viewport, memory: WindowMemory): WindowList {
  const existing = list.windows.find((w) => w.kind === kind && w.ref === ref);
  if (existing) return focusWindow(list, existing.id);
  const id = list.seq + 1;
  if (isNarrow(vp)) {
    return { windows: [{ id, kind, ref, ...narrowRect(vp), z: 1 }], seq: id };
  }
  let windows = list.windows;
  if (windows.length >= MAX_WINDOWS) {
    const oldest = windows.reduce((a, w) => (w.id < a.id ? w : a));
    windows = windows.filter((w) => w.id !== oldest.id);
  }
  const rect = placeNew(windows, kind, vp, memory);
  return { windows: [...windows, { id, kind, ref, ...rect, z: maxZ(windows) + 1 }], seq: id };
}

// ウィンドウを閉じる
export function closeWindow(list: WindowList, id: number): WindowList {
  if (!list.windows.some((w) => w.id === id)) return list;
  return { ...list, windows: list.windows.filter((w) => w.id !== id) };
}

// 指定の種類と ref のウィンドウを閉じる（機器を撤去したときなど）
export function closeRef(list: WindowList, kind: WindowKind, ref: string): WindowList {
  if (!list.windows.some((w) => w.kind === kind && w.ref === ref)) return list;
  return { ...list, windows: list.windows.filter((w) => !(w.kind === kind && w.ref === ref)) };
}

// ウィンドウを動かす。画面の外には出さない。狭い画面では動かさない
export function moveWindow(list: WindowList, id: number, x: number, y: number, vp: Viewport): WindowList {
  if (isNarrow(vp)) return list;
  const target = list.windows.find((w) => w.id === id);
  if (!target) return list;
  const rect = clampRect({ x, y, w: target.w, h: target.h }, vp);
  return { ...list, windows: list.windows.map((w) => (w.id === id ? { ...w, ...rect } : w)) };
}

// ウィンドウの大きさを変える。最小 240×160、画面の外には出さない。狭い画面では変えない
export function resizeWindow(list: WindowList, id: number, w: number, h: number, vp: Viewport): WindowList {
  if (isNarrow(vp)) return list;
  const target = list.windows.find((t) => t.id === id);
  if (!target) return list;
  const nw = clamp(w, MIN_W, Math.max(MIN_W, vp.w - target.x));
  const nh = clamp(h, MIN_H, Math.max(MIN_H, vp.h - target.y));
  const rect = clampRect({ x: target.x, y: target.y, w: nw, h: nh }, vp);
  return { ...list, windows: list.windows.map((t) => (t.id === id ? { ...t, ...rect } : t)) };
}

// 種類ごとの覚えた位置と大きさを、今のウィンドウの位置で更新する
export function remember(memory: WindowMemory, win: WindowItem): WindowMemory {
  return { ...memory, [win.kind]: { x: win.x, y: win.y, w: win.w, h: win.h } };
}

// 保存された文字列を読む。壊れていれば空の記録を返す（例外を出さない）
export function parseMemory(raw: string | null): WindowMemory {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof data !== 'object' || data === null) return {};
  const out: WindowMemory = {};
  for (const kind of ['device', 'staff', 'staffList'] as const) {
    const r = (data as Record<string, unknown>)[kind];
    if (typeof r !== 'object' || r === null) continue;
    const { x, y, w, h } = r as Record<string, unknown>;
    if ([x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      out[kind] = { x: x as number, y: y as number, w: w as number, h: h as number };
    }
  }
  return out;
}
