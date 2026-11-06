// 複数のタブの検出（N27）。後から開いたタブだけが「別のタブで開いている」を受け取る
import { describe, expect, it } from 'vitest';
import { startTabGuard } from './tabGuard';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('startTabGuard', () => {
  it('後から開いたタブだけ衝突を受け取る', async () => {
    let first = 0;
    let second = 0;
    const stopFirst = startTabGuard(() => first++);
    await wait(20);
    const stopSecond = startTabGuard(() => second++);
    await wait(50);
    expect(second).toBeGreaterThan(0);
    expect(first).toBe(0);
    stopSecond();
    stopFirst();
  });
});
