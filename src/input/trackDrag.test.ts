import { describe, expect, it } from 'vitest';
import { trackDrag, type DragDeps, type DragEndReason, type DragOptions } from './trackDrag';

// 偽の登録先とキーの横取り。ポインタとキーを手で流す
const setup = (options: Partial<DragOptions> = {}) => {
  const listeners: Record<string, ((e: PointerEvent) => void)[]> = { pointermove: [], pointerup: [], pointercancel: [] };
  const captures: ((e: KeyboardEvent) => boolean)[] = [];
  const deps: DragDeps = {
    target: {
      addEventListener: (type, l) => void listeners[type].push(l),
      removeEventListener: (type, l) => {
        const i = listeners[type].indexOf(l);
        if (i >= 0) listeners[type].splice(i, 1);
      },
    },
    captureKeys: (h) => {
      captures.push(h);
      return () => captures.splice(captures.indexOf(h), 1);
    },
  };
  const log: string[] = [];
  const ends: { dragged: boolean; reason: DragEndReason }[] = [];
  const stop = trackDrag(
    {
      startX: 100,
      startY: 100,
      onMove: (x, y) => log.push(`move ${x},${y}`),
      onDrop: (x, y) => log.push(`drop ${x},${y}`),
      onEnd: (end) => ends.push(end),
      ...options,
    },
    deps,
  );
  const fire = (type: string, x: number, y: number, pointerId = 1) => listeners[type].slice().forEach((l) => l({ clientX: x, clientY: y, pointerId } as PointerEvent));
  const esc = () => captures.slice().reverse().some((h) => h({ key: 'Escape' } as KeyboardEvent));
  const registered = () => listeners.pointermove.length + listeners.pointerup.length + listeners.pointercancel.length + captures.length;
  return { fire, esc, stop, log, ends, registered };
};

describe('trackDrag（ドラッグを追う）', () => {
  it('しきい値未満の動きはドラッグにしない。離すと release で終わり、drop は呼ばない', () => {
    const t = setup();
    t.fire('pointermove', 102, 100);
    t.fire('pointerup', 102, 100);
    expect(t.log).toEqual([]);
    expect(t.ends).toEqual([{ dragged: false, reason: 'release' }]);
    expect(t.registered()).toBe(0);
  });

  it('動き出したら onMove を呼び、離すと onDrop のあとに drop で終わる', () => {
    const t = setup();
    t.fire('pointermove', 110, 100);
    t.fire('pointermove', 120, 105);
    t.fire('pointerup', 120, 105);
    expect(t.log).toEqual(['move 110,100', 'move 120,105', 'drop 120,105']);
    expect(t.ends).toEqual([{ dragged: true, reason: 'drop' }]);
  });

  it('pointerId を指定したら、ほかのポインタは無視する', () => {
    const t = setup({ pointerId: 7 });
    t.fire('pointermove', 120, 100, 2);
    t.fire('pointerup', 120, 100, 2);
    expect(t.log).toEqual([]);
    expect(t.ends).toEqual([]);
    t.fire('pointermove', 120, 100, 7);
    expect(t.log).toEqual(['move 120,100']);
  });

  it('decide が abort を返したら、ドラッグにせず abort で終わる', () => {
    const t = setup({ decide: (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? 'abort' : 'drag') });
    t.fire('pointermove', 120, 101);
    expect(t.log).toEqual([]);
    expect(t.ends).toEqual([{ dragged: false, reason: 'abort' }]);
    expect(t.registered()).toBe(0);
  });

  it('decide が drag を返したら動き出す', () => {
    const t = setup({ decide: (dx, dy) => (Math.abs(dx) > Math.abs(dy) ? 'abort' : 'drag') });
    t.fire('pointermove', 101, 120);
    expect(t.log).toEqual(['move 101,120']);
  });

  it('Esc は、動き出したあとだけ横取りして escape で終わる。動き出す前は渡す', () => {
    const t = setup();
    expect(t.esc()).toBe(false);
    expect(t.ends).toEqual([]);
    t.fire('pointermove', 120, 100);
    expect(t.esc()).toBe(true);
    expect(t.ends).toEqual([{ dragged: true, reason: 'escape' }]);
    expect(t.registered()).toBe(0);
  });

  it('ブラウザの中断（pointercancel）は cancel で終わる', () => {
    const t = setup();
    t.fire('pointermove', 120, 100);
    t.fire('pointercancel', 120, 100);
    expect(t.ends).toEqual([{ dragged: true, reason: 'cancel' }]);
    expect(t.log).toEqual(['move 120,100']);
  });

  it('呼び出し側から止めると stop で終わり、登録を外す。止めたあとの入力は無視する', () => {
    const t = setup();
    t.fire('pointermove', 120, 100);
    t.stop();
    expect(t.ends).toEqual([{ dragged: true, reason: 'stop' }]);
    expect(t.registered()).toBe(0);
    t.fire('pointerup', 120, 100);
    expect(t.ends).toHaveLength(1);
  });

  it('onEnd は1回だけ呼ぶ', () => {
    const t = setup();
    t.fire('pointermove', 120, 100);
    t.fire('pointerup', 120, 100);
    t.stop();
    expect(t.ends).toHaveLength(1);
  });
});
