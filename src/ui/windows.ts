// 開いているウィンドウの一覧を操作する純粋関数。画面の大きさ（vp）と、種類ごとに覚えた位置・大きさ（memory）は引数で受け取る。
// ウィンドウは種類ごとに1つだけ。機器・社員のウィンドウは、開いたものをタブとして持つ（選んでいるタブが中身を決める）。
// 押したときの描き方（ポインターの処理）は components/Window.tsx、保存と読み込みは stores/useGameStore.ts が受け持つ。

// ウィンドウの種類。機器の画面・社員の札・社員の一覧
// 依頼とショップも、ウィンドウとして開く（N40）。マップの操作を止めない
export type WindowKind = 'device' | 'staff' | 'staffList' | 'offers' | 'shop';
export const WINDOW_KINDS = ['device', 'staff', 'staffList', 'offers', 'shop'] as const satisfies readonly WindowKind[];

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowItem extends Rect {
  id: number;
  kind: WindowKind;
  // 開いているタブ。機器なら機器の uid、社員なら社員の uid、社員の一覧は ''（開いた順）
  tabs: string[];
  // 選んでいるタブ（tabs のどれか）
  active: string;
  // 重なりの順（大きいほど手前）
  z: number;
}

// 画面の大きさと、スマホの配置か（usePhone.ts の判定。ウィンドウはスマホでは1つのシートになる）
export interface Viewport {
  w: number;
  h: number;
  phone: boolean;
}

// 種類ごとに最後に置いた位置と大きさ
export type WindowMemory = Partial<Record<WindowKind, Rect>>;

// ウィンドウの一覧と、次に使う id
export interface WindowList {
  windows: WindowItem[];
  seq: number;
}

// 1つのウィンドウが持つタブの最大数。超えたら一番古いタブを閉じる
export const MAX_TABS = 8;
export const MIN_W = 240;
export const MIN_H = 160;
// 新しいウィンドウを前のものからずらす量
export const CASCADE_PX = 24;
// これより狭い画面では、移動と大きさの変更をせず、画面の下に1つだけ出す
export const NARROW_HEIGHT_RATIO = 0.6;
// 狭い画面で下に出すとき、ツールバーのために空けておく高さ
export const NARROW_BOTTOM_RESERVE = 64;

const DEFAULT_SIZE: Record<WindowKind, { w: number; h: number }> = {
  device: { w: 300, h: 360 },
  staff: { w: 300, h: 360 },
  staffList: { w: 420, h: 360 },
  offers: { w: 420, h: 460 },
  shop: { w: 420, h: 420 },
};
// 初めて開くときの位置（右上。上端は画面の上の欄の下）
const DEFAULT_TOP = 44;
const DEFAULT_RIGHT = 8;

const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), Math.max(lo, hi));

// スマホの配置か（判定は usePhone.ts の1か所）
export const isNarrow = (vp: Viewport): boolean => vp.phone;

// 画面の外に出ないように、大きさを最小から画面までに収め、位置を画面の中に寄せる
export function clampRect(r: Rect, vp: Viewport): Rect {
  const w = clamp(r.w, MIN_W, vp.w);
  const h = clamp(r.h, MIN_H, vp.h);
  return { x: clamp(r.x, 0, vp.w - w), y: clamp(r.y, 0, vp.h - h), w, h };
}

// スマホのパネル: 画面全体を覆う1枚（移動も大きさの変更もしない。戻るで閉じる）
export function narrowRect(vp: Viewport): Rect {
  return { x: 0, y: 0, w: vp.w, h: vp.h };
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

// 種類のウィンドウ（なければ undefined）。種類ごとに1つだけ
const windowOf = (list: WindowList, kind: WindowKind): WindowItem | undefined => list.windows.find((w) => w.kind === kind);

// 指定のウィンドウだけを書き換える
const patch = (list: WindowList, id: number, change: Partial<WindowItem>): WindowList => ({
  ...list,
  windows: list.windows.map((w) => (w.id === id ? { ...w, ...change } : w)),
});

// ウィンドウを手前に出す。すでに一番手前なら同じ一覧を返す
export function focusWindow(list: WindowList, id: number): WindowList {
  const target = list.windows.find((w) => w.id === id);
  if (!target || target.z === maxZ(list.windows)) return list;
  const z = maxZ(list.windows) + 1;
  return patch(list, id, { z });
}

// タブを選んで、そのウィンドウを手前に出す。タブがなければ加える（最大 MAX_TABS を超えたら、一番古いタブを外す）
function showTab(list: WindowList, id: number, ref: string): WindowList {
  const target = list.windows.find((w) => w.id === id);
  if (!target) return list;
  let tabs = target.tabs;
  if (!tabs.includes(ref)) {
    tabs = [...tabs, ref];
    if (tabs.length > MAX_TABS) tabs = tabs.slice(tabs.length - MAX_TABS);
  }
  return focusWindow(patch(list, id, { tabs, active: ref }), id);
}

// 機器・社員を開く。その種類のウィンドウが開いていれば、タブを加えて選ぶ（すでにあれば選ぶだけ）。
// なければ新しいウィンドウを開く。狭い画面では、ほかを閉じて1つだけ出す
export function openWindow(list: WindowList, kind: WindowKind, ref: string, vp: Viewport, memory: WindowMemory): WindowList {
  const existing = windowOf(list, kind);
  if (existing) return showTab(list, existing.id, ref);
  const id = list.seq + 1;
  if (isNarrow(vp)) {
    return { windows: [{ id, kind, tabs: [ref], active: ref, ...narrowRect(vp), z: 1 }], seq: id };
  }
  const rect = placeNew(list.windows, kind, vp, memory);
  return { windows: [...list.windows, { id, kind, tabs: [ref], active: ref, ...rect, z: maxZ(list.windows) + 1 }], seq: id };
}

// マップで同じ機器・社員をもう一度押したとき。そのタブが選ばれていて一番手前なら閉じ、選ばれていなければ選ぶ。
// タブがなければ開く
export function toggleWindow(list: WindowList, kind: WindowKind, ref: string, vp: Viewport, memory: WindowMemory): WindowList {
  const existing = windowOf(list, kind);
  if (existing && existing.tabs.includes(ref)) {
    const front = frontWindow(list.windows);
    if (front?.id === existing.id && existing.active === ref) return closeTab(list, existing.id, ref);
    return showTab(list, existing.id, ref);
  }
  return openWindow(list, kind, ref, vp, memory);
}

// タブを選ぶ（ウィンドウは手前に出す）。そのタブがなければ何もしない
export function selectTab(list: WindowList, id: number, ref: string): WindowList {
  const target = list.windows.find((w) => w.id === id);
  if (!target || !target.tabs.includes(ref)) return list;
  return showTab(list, id, ref);
}

// タブの並べ替え。from のタブを to の位置へ動かす（選んでいるタブは変わらない）。範囲外や同じ位置なら同じ一覧を返す
export function reorderTab(list: WindowList, id: number, from: number, to: number): WindowList {
  const target = list.windows.find((w) => w.id === id);
  if (!target || from === to || from < 0 || to < 0 || from >= target.tabs.length || to >= target.tabs.length) return list;
  const tabs = [...target.tabs];
  const [moved] = tabs.splice(from, 1);
  tabs.splice(to, 0, moved);
  return patch(list, id, { tabs });
}

// タブを閉じる。選んでいたタブを閉じたら、右隣（なければ左隣）を選ぶ。最後のタブを閉じたらウィンドウも閉じる
export function closeTab(list: WindowList, id: number, ref: string): WindowList {
  const target = list.windows.find((w) => w.id === id);
  if (!target) return list;
  const idx = target.tabs.indexOf(ref);
  if (idx < 0) return list;
  const tabs = target.tabs.filter((_, i) => i !== idx);
  if (tabs.length === 0) return closeWindow(list, id);
  const active = target.active !== ref ? target.active : tabs[Math.min(idx, tabs.length - 1)];
  return patch(list, id, { tabs, active });
}

// ウィンドウを閉じる（タブもすべて閉じる）
export function closeWindow(list: WindowList, id: number): WindowList {
  if (!list.windows.some((w) => w.id === id)) return list;
  return { ...list, windows: list.windows.filter((w) => w.id !== id) };
}

// 指定の種類のウィンドウから、指定のタブを閉じる（機器を撤去したときなど）
export function closeRef(list: WindowList, kind: WindowKind, ref: string): WindowList {
  const existing = windowOf(list, kind);
  if (!existing) return list;
  return closeTab(list, existing.id, ref);
}

// ウィンドウを動かす。画面の外には出さない。狭い画面では動かさない
export function moveWindow(list: WindowList, id: number, x: number, y: number, vp: Viewport): WindowList {
  if (isNarrow(vp)) return list;
  const target = list.windows.find((w) => w.id === id);
  if (!target) return list;
  const rect = clampRect({ x, y, w: target.w, h: target.h }, vp);
  return patch(list, id, rect);
}

// ウィンドウの大きさを変える。最小 240×160、画面の外には出さない。狭い画面では変えない
export function resizeWindow(list: WindowList, id: number, w: number, h: number, vp: Viewport): WindowList {
  if (isNarrow(vp)) return list;
  const target = list.windows.find((t) => t.id === id);
  if (!target) return list;
  const nw = clamp(w, MIN_W, Math.max(MIN_W, vp.w - target.x));
  const nh = clamp(h, MIN_H, Math.max(MIN_H, vp.h - target.y));
  const rect = clampRect({ x: target.x, y: target.y, w: nw, h: nh }, vp);
  return patch(list, id, rect);
}

// 動かす辺（N57）。n は上、s は下、e は右、w は左
export interface Edges {
  n?: boolean;
  s?: boolean;
  e?: boolean;
  w?: boolean;
}

// 辺をドラッグしたときの位置と大きさ（N57）。開始時の位置と大きさ（start）から求める。
// 動かさない辺は動かさず、反対側の辺を基準に最小の大きさ（MIN_W・MIN_H）と画面の外に出さない制約をかける
export function resizeRect(start: Rect, edges: Edges, dx: number, dy: number, vp: Viewport): Rect {
  let { x, y, w, h } = start;
  if (edges.e) w = clamp(start.w + dx, MIN_W, vp.w - start.x);
  if (edges.w) {
    const right = start.x + start.w;
    w = clamp(start.w - dx, MIN_W, right);
    x = right - w;
  }
  if (edges.s) h = clamp(start.h + dy, MIN_H, vp.h - start.y);
  if (edges.n) {
    const bottom = start.y + start.h;
    h = clamp(start.h - dy, MIN_H, bottom);
    y = bottom - h;
  }
  return clampRect({ x, y, w, h }, vp);
}

// ウィンドウの位置と大きさを、そのまま置く（画面の外には出さない）。狭い画面では変えない（N57）
export function placeWindow(list: WindowList, id: number, rect: Rect, vp: Viewport): WindowList {
  if (isNarrow(vp)) return list;
  if (!list.windows.some((t) => t.id === id)) return list;
  return patch(list, id, clampRect(rect, vp));
}

// 画面の大きさが変わったとき、開いているすべてのウィンドウを画面の中に収める（大きさは最小から画面まで）。変わらなければ同じ一覧を返す
export function fitWindows(list: WindowList, vp: Viewport): WindowList {
  let changed = false;
  const windows = list.windows.map((w) => {
    const r = clampRect(w, vp);
    if (r.x === w.x && r.y === w.y && r.w === w.w && r.h === w.h) return w;
    changed = true;
    return { ...w, ...r };
  });
  return changed ? { ...list, windows } : list;
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
  for (const kind of WINDOW_KINDS) {
    const r = (data as Record<string, unknown>)[kind];
    if (typeof r !== 'object' || r === null) continue;
    const { x, y, w, h } = r as Record<string, unknown>;
    if ([x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v))) {
      out[kind] = { x: x as number, y: y as number, w: w as number, h: h as number };
    }
  }
  return out;
}
