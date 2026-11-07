// 複数のタブの検出（N27・N133）。同じ会社を開いたときだけ、後から開いたタブが「別のタブで開いている」を受け取る
import { describe, expect, it } from 'vitest';
import { sameCompany, startTabGuard } from './tabGuard';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('startTabGuard', () => {
  it('同じ会社を開いたら、後から開いたタブだけ衝突を受け取る', async () => {
    let first = 0;
    let second = 0;
    const first_ = startTabGuard(() => first++, 11);
    await wait(20);
    const second_ = startTabGuard(() => second++, 11);
    await wait(50);
    expect(second).toBeGreaterThan(0);
    expect(first).toBe(0);
    second_.stop();
    first_.stop();
  });

  it('別の会社なら、同時に開ける（衝突しない）', async () => {
    let first = 0;
    let second = 0;
    const a = startTabGuard(() => first++, 11);
    await wait(20);
    const b = startTabGuard(() => second++, 12);
    await wait(50);
    expect(first + second).toBe(0);
    a.stop();
    b.stop();
  });

  it('会社を開く前（タイトル画面）の2つのタブは衝突しない', async () => {
    let count = 0;
    const a = startTabGuard(() => count++, null);
    await wait(20);
    const b = startTabGuard(() => count++, null);
    await wait(50);
    expect(count).toBe(0);
    a.stop();
    b.stop();
  });
});

describe('sameCompany', () => {
  it('同じ枠だけ同じ会社。null は会社を開いていないため違う', () => {
    expect(sameCompany(11, 11)).toBe(true);
    expect(sameCompany(11, 12)).toBe(false);
    expect(sameCompany(null, null)).toBe(false);
    expect(sameCompany(11, null)).toBe(false);
  });
});
