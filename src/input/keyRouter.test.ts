import { describe, expect, it } from 'vitest';
import { createKeyRouter } from './keyRouter';

// 偽の window。登録された処理を、capture と bubble に分けて覚える
const fakeWindow = () => {
  const capture: ((e: KeyboardEvent) => void)[] = [];
  const bubble: ((e: KeyboardEvent) => void)[] = [];
  return {
    addEventListener: (_: 'keydown', l: (e: KeyboardEvent) => void, c?: boolean) => void (c ? capture : bubble).push(l),
    removeEventListener: (_: 'keydown', l: (e: KeyboardEvent) => void, c?: boolean) => {
      const list = c ? capture : bubble;
      const i = list.indexOf(l);
      if (i >= 0) list.splice(i, 1);
    },
    capture,
    bubble,
  };
};

// キーの入力を偽の window へ流す。capture で止められたら bubble へは届かない（stopImmediatePropagation）
const press = (win: ReturnType<typeof fakeWindow>, key = 'Escape') => {
  const e = { key, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  for (const l of win.capture) l(e as unknown as KeyboardEvent);
  if (!e.stopped) for (const l of win.bubble) l(e as unknown as KeyboardEvent);
  return e;
};

describe('キー入力の受け口', () => {
  it('横取りが処理したキーは、層にもキーの表にも渡さない', () => {
    const log: string[] = [];
    const router = createKeyRouter(() => (log.push('table'), true));
    router.captureKeys(() => (log.push('capture'), true));
    router.addKeyLayer(() => (log.push('layer'), true));
    const win = fakeWindow();
    router.attach(win, { table: true });
    const e = press(win);
    expect(log).toEqual(['capture']);
    expect(e.prevented).toBe(true);
  });

  it('横取りは、あとから登録したものが先に受ける。処理しなければ次へ渡す', () => {
    const log: string[] = [];
    const router = createKeyRouter(() => false);
    router.captureKeys(() => (log.push('first'), true));
    router.captureKeys(() => (log.push('second'), false));
    const win = fakeWindow();
    router.attach(win, { table: false });
    press(win);
    expect(log).toEqual(['second', 'first']);
  });

  it('横取りを外すと、そのあとのキーは受けない', () => {
    const log: string[] = [];
    const router = createKeyRouter(() => false);
    const release = router.captureKeys(() => (log.push('capture'), true));
    const win = fakeWindow();
    router.attach(win, { table: false });
    release();
    press(win);
    expect(log).toEqual([]);
  });

  it('層の次にキーの表を引く。層が処理したら表は引かない', () => {
    const log: string[] = [];
    const router = createKeyRouter(() => (log.push('table'), true));
    const release = router.addKeyLayer(() => (log.push('layer'), true));
    const win = fakeWindow();
    router.attach(win, { table: true });
    press(win);
    expect(log).toEqual(['layer']);
    release();
    log.length = 0;
    expect(press(win).prevented).toBe(true);
    expect(log).toEqual(['table']);
  });

  it('table が false のときは、キーの表を引かない（タイトルの場面）', () => {
    const log: string[] = [];
    const router = createKeyRouter(() => (log.push('table'), true));
    const win = fakeWindow();
    router.attach(win, { table: false });
    press(win);
    expect(log).toEqual([]);
  });

  it('外すと、window への登録がなくなる', () => {
    const router = createKeyRouter(() => false);
    const win = fakeWindow();
    const detach = router.attach(win, { table: true });
    expect(win.capture.length + win.bubble.length).toBe(2);
    detach();
    expect(win.capture.length + win.bubble.length).toBe(0);
  });
});
