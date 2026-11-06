import { describe, expect, it } from 'vitest';
import {
  CASCADE_PX,
  MAX_TABS,
  MIN_H,
  MIN_W,
  clampRect,
  closeRef,
  closeTab,
  closeWindow,
  defaultRect,
  fitWindows,
  focusWindow,
  frontWindow,
  moveWindow,
  narrowRect,
  openWindow,
  parseMemory,
  remember,
  resizeWindow,
  selectTab,
  toggleWindow,
  type WindowKind,
  type WindowItem,
  type WindowList,
  type WindowMemory,
  placeWindow,
  resizeRect,
} from './windows';

const WIDE = { w: 1280, h: 800, phone: false };
const NARROW = { w: 600, h: 900, phone: true };
const NONE: WindowMemory = {};
const empty: WindowList = { windows: [], seq: 0 };

const open = (list: WindowList, ref: string, kind: WindowKind = 'device', vp = WIDE, memory = NONE) =>
  openWindow(list, kind, ref, vp, memory);
const toggle = (list: WindowList, ref: string, kind: WindowKind = 'device', vp = WIDE, memory = NONE) =>
  toggleWindow(list, kind, ref, vp, memory);
// 種類のウィンドウ（1つだけのはず）
const of = (list: WindowList, kind: WindowKind = 'device') => {
  const w = list.windows.filter((x) => x.kind === kind);
  expect(w.length).toBeLessThanOrEqual(1);
  return w[0];
};

describe('ウィンドウを開く', () => {
  it('新しいウィンドウは、右上の初期の位置に、そのタブを選んで開く', () => {
    const list = open(empty, 'pc_a');
    expect(list.windows).toHaveLength(1);
    const w = list.windows[0];
    expect(w).toMatchObject({ id: 1, kind: 'device', tabs: ['pc_a'], active: 'pc_a' });
    expect(w.x + w.w).toBe(WIDE.w - 8);
    expect(w.y).toBe(44);
    expect(list.seq).toBe(1);
  });

  it('同じ種類のウィンドウが開いていれば、新しく開かずにタブとして加えて選ぶ', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b');
    expect(list.windows).toHaveLength(1);
    expect(of(list)).toMatchObject({ tabs: ['pc_a', 'pc_b'], active: 'pc_b' });
    expect(list.seq).toBe(1);
  });

  it('すでにあるタブを開くと、タブは増えず、選ぶだけになる', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b');
    list = open(list, 'pc_a');
    expect(of(list)).toMatchObject({ tabs: ['pc_a', 'pc_b'], active: 'pc_a' });
    expect(frontWindow(list.windows)?.kind).toBe('device');
  });

  it('タブを選ぶと、そのウィンドウが一番手前に出る', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b', 'staff');
    expect(frontWindow(list.windows)?.kind).toBe('staff');
    list = open(list, 'pc_a');
    expect(frontWindow(list.windows)?.kind).toBe('device');
    expect(of(list)?.active).toBe('pc_a');
  });

  it('機器・社員・社員の一覧は、それぞれ別のウィンドウとして開く', () => {
    let list = open(empty, 'x1', 'device');
    list = open(list, 'x1', 'staff');
    list = openWindow(list, 'staffList', '', WIDE, NONE);
    expect(list.windows.map((w) => w.kind)).toEqual(['device', 'staff', 'staffList']);
  });

  it('別の種類のウィンドウを開くと、前のウィンドウから 24 px ずらして開く', () => {
    const memory: WindowMemory = { device: { x: 100, y: 100, w: 300, h: 360 } };
    let list = open(empty, 'pc_a', 'device', WIDE, memory);
    list = open(list, 'pc_b', 'staff', WIDE, memory);
    const a = of(list, 'device');
    const b = of(list, 'staff');
    expect(b.x).toBe(a.x + CASCADE_PX);
    expect(b.y).toBe(a.y + CASCADE_PX);
  });

  it('ずらすと画面の外に出る方向は、端に戻して続ける（右端の初期の位置からは左端へ）', () => {
    const vp = { w: 800, h: 800, phone: false };
    let list = open(empty, 'pc_a', 'device', vp);
    list = open(list, 'pc_b', 'staff', vp);
    const a = of(list, 'device');
    const b = of(list, 'staff');
    expect(b.x).toBe(8);
    expect(b.y).toBe(a.y + CASCADE_PX);
    expect(b.x + b.w).toBeLessThanOrEqual(vp.w);
  });

  it('タブは最大 8 つ。9つ目を開くと、一番古いタブを閉じる', () => {
    let list = empty;
    for (let i = 1; i <= MAX_TABS; i++) list = open(list, `pc_${i}`);
    expect(of(list).tabs).toHaveLength(MAX_TABS);
    list = open(list, 'pc_9');
    expect(of(list).tabs).toHaveLength(MAX_TABS);
    expect(of(list).tabs).not.toContain('pc_1');
    expect(of(list)).toMatchObject({ active: 'pc_9' });
    expect(of(list).tabs[MAX_TABS - 1]).toBe('pc_9');
  });

  it('一番古いタブは開いた順で決まる（選び直しても古さは変わらない）', () => {
    let list = empty;
    for (let i = 1; i <= MAX_TABS; i++) list = open(list, `pc_${i}`);
    list = open(list, 'pc_1'); // 選ぶだけ。古さは変わらない
    list = open(list, 'pc_9');
    expect(of(list).tabs).not.toContain('pc_1');
    expect(of(list).tabs).toContain('pc_2');
  });

  it('覚えた位置と大きさがあれば、それを使う（画面に収めて）', () => {
    const memory: WindowMemory = { device: { x: 100, y: 120, w: 420, h: 300 } };
    const list = open(empty, 'pc_a', 'device', WIDE, memory);
    expect(list.windows[0]).toMatchObject({ x: 100, y: 120, w: 420, h: 300 });
  });

  it('狭い画面では、別の種類のウィンドウを開くと、ほかを閉じて画面いっぱいのパネルを1つだけ出す', () => {
    let list = open(empty, 'pc_a', 'device', NARROW);
    list = open(list, 'pc_b', 'staff', NARROW);
    expect(list.windows).toHaveLength(1);
    expect(list.windows[0]).toMatchObject({ kind: 'staff', tabs: ['pc_b'], active: 'pc_b' });
    expect(list.windows[0].w).toBe(NARROW.w);
    expect(list.windows[0].h).toBe(NARROW.h);
    expect(list.windows[0].y).toBe(0);
  });

  it('狭い画面でも、同じ種類なら1つのウィンドウにタブとして加える', () => {
    let list = open(empty, 'pc_a', 'device', NARROW);
    list = open(list, 'pc_b', 'device', NARROW);
    expect(list.windows).toHaveLength(1);
    expect(list.windows[0]).toMatchObject({ tabs: ['pc_a', 'pc_b'], active: 'pc_b' });
  });
});

describe('タブを選ぶ・閉じる', () => {
  it('selectTab は、タブを選んでウィンドウを手前に出す。ないタブは何もしない', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b');
    list = open(list, 'pc_c', 'staff');
    const id = of(list).id;
    list = selectTab(list, id, 'pc_a');
    expect(of(list)).toMatchObject({ active: 'pc_a' });
    expect(frontWindow(list.windows)?.id).toBe(id);
    expect(selectTab(list, id, 'nothing')).toBe(list);
  });

  it('選んでいるタブを閉じると、右隣を選ぶ（右がなければ左隣）', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b');
    list = open(list, 'pc_c');
    list = selectTab(list, of(list).id, 'pc_b');
    list = closeTab(list, of(list).id, 'pc_b');
    expect(of(list)).toMatchObject({ tabs: ['pc_a', 'pc_c'], active: 'pc_c' });
    list = closeTab(list, of(list).id, 'pc_c');
    expect(of(list)).toMatchObject({ tabs: ['pc_a'], active: 'pc_a' });
  });

  it('選んでいないタブを閉じても、選んでいるタブはそのまま', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b');
    list = closeTab(list, of(list).id, 'pc_a');
    expect(of(list)).toMatchObject({ tabs: ['pc_b'], active: 'pc_b' });
  });

  it('最後のタブを閉じると、ウィンドウも閉じる', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b', 'staff');
    list = closeTab(list, of(list, 'device').id, 'pc_a');
    expect(list.windows.map((w) => w.kind)).toEqual(['staff']);
    list = closeTab(list, of(list, 'staff').id, 'pc_b');
    expect(list.windows).toHaveLength(0);
  });

  it('ないタブ・ないウィンドウを閉じても変わらない', () => {
    const list = open(empty, 'pc_a');
    expect(closeTab(list, of(list).id, 'nothing')).toBe(list);
    expect(closeTab(list, 99, 'pc_a')).toBe(list);
  });

  it('closeWindow は、タブもまとめてウィンドウを閉じる。ない id は変わらない', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b');
    list = open(list, 'pc_c', 'staff');
    list = closeWindow(list, of(list, 'device').id);
    expect(list.windows.map((w) => w.kind)).toEqual(['staff']);
    expect(closeWindow(list, 99)).toBe(list);
  });

  it('closeRef は、その機器のタブだけを閉じ、ほかのタブは残す', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b');
    list = closeRef(list, 'device', 'pc_a');
    expect(of(list)).toMatchObject({ tabs: ['pc_b'], active: 'pc_b' });
    list = closeRef(list, 'device', 'pc_b');
    expect(list.windows).toHaveLength(0);
    expect(closeRef(list, 'device', 'nothing')).toBe(list);
  });

  it('手前に出すと、一番手前になる。すでに手前なら同じ一覧を返す', () => {
    let list = open(empty, 'pc_a');
    list = open(list, 'pc_b', 'staff');
    const device = of(list, 'device');
    list = focusWindow(list, device.id);
    expect(frontWindow(list.windows)?.kind).toBe('device');
    expect(focusWindow(list, device.id)).toBe(list);
  });
});

describe('動かす・大きさを変える', () => {
  it('動かした位置に移す（大きさは変えない）', () => {
    let list = open(empty, 'pc_a');
    const id = list.windows[0].id;
    list = moveWindow(list, id, 50, 60, WIDE);
    expect(list.windows[0]).toMatchObject({ x: 50, y: 60, w: 300, h: 360 });
  });

  it('画面の外には出さない（左・上・右・下）', () => {
    let list = open(empty, 'pc_a');
    const id = list.windows[0].id;
    const w = list.windows[0].w;
    const h = list.windows[0].h;
    list = moveWindow(list, id, -500, -500, WIDE);
    expect(list.windows[0]).toMatchObject({ x: 0, y: 0 });
    list = moveWindow(list, id, 99999, 99999, WIDE);
    expect(list.windows[0]).toMatchObject({ x: WIDE.w - w, y: WIDE.h - h });
  });

  it('大きさを変えても、最小 240×160 を下回らない', () => {
    let list = open(empty, 'pc_a');
    const id = list.windows[0].id;
    list = resizeWindow(list, id, 10, 10, WIDE);
    expect(list.windows[0]).toMatchObject({ w: MIN_W, h: MIN_H });
  });

  it('大きさを変えても、画面の外には出さない', () => {
    let list = open(empty, 'pc_a');
    const id = list.windows[0].id;
    list = moveWindow(list, id, 100, 100, WIDE);
    list = resizeWindow(list, id, 5000, 5000, WIDE);
    const w = list.windows[0];
    expect(w.x + w.w).toBeLessThanOrEqual(WIDE.w);
    expect(w.y + w.h).toBeLessThanOrEqual(WIDE.h);
    expect(w.x).toBeGreaterThanOrEqual(0);
  });

  it('狭い画面では、動かしても大きさを変えても変わらない', () => {
    const list = open(empty, 'pc_a', 'device', NARROW);
    expect(moveWindow(list, list.windows[0].id, 10, 10, NARROW)).toBe(list);
    expect(resizeWindow(list, list.windows[0].id, 400, 400, NARROW)).toBe(list);
  });
});

describe('画面の大きさが変わったとき', () => {
  it('画面の外に出たウィンドウは、画面の中に寄せる', () => {
    let list = open(empty, 'pc_a');
    list = moveWindow(list, list.windows[0].id, 900, 500, WIDE);
    const fitted = fitWindows(list, { w: 800, h: 600, phone: false });
    expect(fitted.windows[0]).toMatchObject({ x: 500, y: 240, w: 300, h: 360 });
  });

  it('画面より大きいウィンドウは縮めるが、最小の大きさは守る', () => {
    const list = open(empty, 'pc_a');
    const fitted = fitWindows(list, { w: 200, h: 100, phone: false });
    expect(fitted.windows[0]).toMatchObject({ x: 0, y: 0, w: MIN_W, h: MIN_H });
  });

  it('収まっているウィンドウだけなら、同じ一覧を返す', () => {
    const list = open(empty, 'pc_a');
    expect(fitWindows(list, WIDE)).toBe(list);
  });
});

describe('画面の大きさの計算', () => {
  it('clampRect は、大きさを最小から画面までに収め、位置を画面の中に寄せる', () => {
    expect(clampRect({ x: -10, y: -10, w: 100, h: 100 }, WIDE)).toEqual({ x: 0, y: 0, w: MIN_W, h: MIN_H });
    expect(clampRect({ x: 1200, y: 780, w: 300, h: 360 }, WIDE)).toEqual({ x: 980, y: 440, w: 300, h: 360 });
  });

  it('narrowRect は、スマホでは画面全体を覆う1枚（移動・大きさの変更なし）', () => {
    const r = narrowRect({ w: 600, h: 1000, phone: true });
    expect(r).toEqual({ x: 0, y: 0, w: 600, h: 1000 });
  });

  it('defaultRect は覚えた位置を使い、覚えていなければ右上', () => {
    const memory: WindowMemory = { device: { x: 2000, y: 0, w: 300, h: 300 } };
    expect(defaultRect('device', WIDE, memory)).toMatchObject({ x: WIDE.w - 300, y: 0 });
    expect(defaultRect('device', WIDE, NONE).y).toBe(44);
  });
});

describe('覚える位置と大きさ', () => {
  it('remember は種類ごとに位置と大きさを覚える', () => {
    let list = open(empty, 'pc_a');
    list = moveWindow(list, list.windows[0].id, 40, 50, WIDE);
    const memory = remember(NONE, list.windows[0]);
    expect(memory.device).toEqual({ x: 40, y: 50, w: 300, h: 360 });
    expect(memory.staff).toBeUndefined();
  });

  it('parseMemory は保存された値を読み、壊れていれば空を返す', () => {
    const good = JSON.stringify({ device: { x: 1, y: 2, w: 300, h: 360 } });
    expect(parseMemory(good)).toEqual({ device: { x: 1, y: 2, w: 300, h: 360 } });
    expect(parseMemory(null)).toEqual({});
    expect(parseMemory('{not json')).toEqual({});
    expect(parseMemory('[1,2]')).toEqual({});
    expect(parseMemory(JSON.stringify({ device: { x: 'a', y: 0, w: 1, h: 1 } }))).toEqual({});
  });
});

describe('社員の一覧のウィンドウ', () => {
  it('社員の一覧は、開く位置と大きさを種類ごとに覚えて読み直せる', () => {
    const memory = parseMemory(JSON.stringify({ staffList: { x: 10, y: 20, w: 400, h: 300 } }));
    expect(memory.staffList).toEqual({ x: 10, y: 20, w: 400, h: 300 });
    const list = openWindow(empty, 'staffList', '', WIDE, memory);
    expect(list.windows[0]).toMatchObject({ kind: 'staffList', x: 10, y: 20, w: 400, h: 300, tabs: [''] });
  });

  it('同じ一覧をもう一度開くと、新しく開かずに手前に出す（タブは増えない）', () => {
    const first = openWindow(empty, 'staffList', '', WIDE, NONE);
    const second = openWindow(first, 'staffList', '', WIDE, NONE);
    expect(second.windows).toHaveLength(1);
    expect(second.windows[0].tabs).toEqual(['']);
  });
});

describe('同じ機器・社員をもう一度押す（toggleWindow）', () => {
  it('開いていなければ開く', () => {
    expect(toggle(empty, 'pc_a').windows).toHaveLength(1);
  });

  it('選ばれていて一番手前のタブなら閉じる（タブが1つならウィンドウも閉じる）', () => {
    const list = toggle(empty, 'pc_a');
    expect(toggle(list, 'pc_a').windows).toHaveLength(0);
  });

  it('選ばれていて一番手前のタブなら閉じる（ほかのタブは残る）', () => {
    let list = toggle(empty, 'pc_a');
    list = toggle(list, 'pc_b');
    list = toggle(list, 'pc_b');
    expect(of(list)).toMatchObject({ tabs: ['pc_a'], active: 'pc_a' });
  });

  it('タブはあるが選ばれていなければ、閉じずに選ぶ', () => {
    let list = toggle(empty, 'pc_a');
    list = toggle(list, 'pc_b');
    list = toggle(list, 'pc_a');
    expect(of(list)).toMatchObject({ tabs: ['pc_a', 'pc_b'], active: 'pc_a' });
  });

  it('選ばれていても、ウィンドウが奥なら閉じずに手前に出す', () => {
    let list = toggle(empty, 'pc_a');
    list = open(list, 'x1', 'staff');
    list = toggle(list, 'pc_a');
    expect(list.windows).toHaveLength(2);
    expect(frontWindow(list.windows)?.kind).toBe('device');
    expect(of(list)).toMatchObject({ tabs: ['pc_a'], active: 'pc_a' });
  });

  it('同じ種類のウィンドウが開いていて、タブがなければ、タブとして加える', () => {
    let list = toggle(empty, 'pc_a');
    list = toggle(list, 'pc_b');
    expect(list.windows).toHaveLength(1);
    expect(of(list)).toMatchObject({ tabs: ['pc_a', 'pc_b'], active: 'pc_b' });
  });
});

describe('resizeRect（辺と角のドラッグ。N57）', () => {
  const start = { x: 300, y: 200, w: 400, h: 300 };
  it('右辺は幅だけ、左辺は反対の右辺を固定して位置も動かす', () => {
    expect(resizeRect(start, { e: true }, 50, 0, WIDE)).toEqual({ x: 300, y: 200, w: 450, h: 300 });
    expect(resizeRect(start, { w: true }, -50, 0, WIDE)).toEqual({ x: 250, y: 200, w: 450, h: 300 });
  });
  it('上辺は下の辺を固定し、下辺は上の辺を固定する', () => {
    expect(resizeRect(start, { n: true }, 0, -40, WIDE)).toEqual({ x: 300, y: 160, w: 400, h: 340 });
    expect(resizeRect(start, { s: true }, 0, 40, WIDE)).toEqual({ x: 300, y: 200, w: 400, h: 340 });
  });
  it('角は2つの辺を同時に動かす', () => {
    expect(resizeRect(start, { n: true, w: true }, -20, -30, WIDE)).toEqual({ x: 280, y: 170, w: 420, h: 330 });
    expect(resizeRect(start, { s: true, e: true }, 20, 30, WIDE)).toEqual({ x: 300, y: 200, w: 420, h: 330 });
  });
  it('最小の大きさで止まるとき、反対の辺は動かない', () => {
    // 左辺を右へ大きく動かしても、幅は最小のまま。右の辺（x+w = 700）は固定
    const r = resizeRect(start, { w: true }, 1000, 0, WIDE);
    expect(r.w).toBe(MIN_W);
    expect(r.x + r.w).toBe(700);
    // 上辺を下へ大きく動かしても、高さは最小のまま。下の辺（y+h = 500）は固定
    const t = resizeRect(start, { n: true }, 0, 1000, WIDE);
    expect(t.h).toBe(MIN_H);
    expect(t.y + t.h).toBe(500);
  });
  it('画面の外には出さない', () => {
    const r = resizeRect(start, { e: true, s: true }, 5000, 5000, WIDE);
    expect(r.x + r.w).toBeLessThanOrEqual(WIDE.w);
    expect(r.y + r.h).toBeLessThanOrEqual(WIDE.h);
    const l = resizeRect(start, { w: true }, 5000, 0, WIDE);
    expect(l.x).toBeGreaterThanOrEqual(0);
  });
});

describe('placeWindow（位置と大きさを置く。N57）', () => {
  it('狭い画面では変えない・画面の外には出さない', () => {
    const list = { windows: [{ id: 1, kind: 'device', x: 10, y: 10, w: 300, h: 200 } as WindowItem], seq: 2 } as WindowList;
    expect(placeWindow(list, 1, { x: 0, y: 0, w: 300, h: 200 }, NARROW)).toBe(list);
    const moved = placeWindow(list, 1, { x: 5000, y: 5000, w: 300, h: 200 }, WIDE);
    expect(moved.windows[0].x + moved.windows[0].w).toBeLessThanOrEqual(WIDE.w);
  });
});
