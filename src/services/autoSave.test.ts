import { describe, expect, it } from 'vitest';
import { createSaveQueue, isAutoSaveDue } from './autoSave';

const day = 24 * 60;

describe('isAutoSaveDue（自動保存の判定）', () => {
  it('しないのときは、どの時間でも保存しない', () => {
    expect(isAutoSaveDue('off', day - 60, day)).toBe(false);
    expect(isAutoSaveDue('off', 0, 30 * day)).toBe(false);
  });

  it('毎日: 朝0時を越えたときだけ保存する', () => {
    expect(isAutoSaveDue('daily', day - 60, day)).toBe(true);
    expect(isAutoSaveDue('daily', day, day + 60)).toBe(false);
    expect(isAutoSaveDue('daily', 0, 3 * day)).toBe(true);
  });

  it('毎日: 時間が変わらないとき、または戻ったとき（読み込み）は保存しない', () => {
    expect(isAutoSaveDue('daily', day + 100, day + 100)).toBe(false);
    expect(isAutoSaveDue('daily', 5 * day, 0)).toBe(false);
  });

  it('毎週: 7日ごとの朝0時を越えたときだけ保存する', () => {
    expect(isAutoSaveDue('weekly', 6 * day + 100, 7 * day)).toBe(true);
    expect(isAutoSaveDue('weekly', day, 6 * day + (day - 1))).toBe(false);
    expect(isAutoSaveDue('weekly', 7 * day, 13 * day + (day - 1))).toBe(false);
    expect(isAutoSaveDue('weekly', 13 * day, 14 * day)).toBe(true);
  });

  it('毎週: 1週間以上をまたいで進んだときも、保存は1回分の判定として当たる', () => {
    expect(isAutoSaveDue('weekly', 2 * day, 20 * day)).toBe(true);
  });
});

describe('createSaveQueue（保存の直列化）', () => {
  it('要求が1回なら、保存は1回だけ行う', async () => {
    let calls = 0;
    const queue = createSaveQueue(async () => {
      calls++;
    });
    await queue();
    expect(calls).toBe(1);
  });

  it('実行中に来た要求は、終わってから1回だけまとめて行う', async () => {
    const gates: Array<() => void> = [];
    let calls = 0;
    const queue = createSaveQueue(() => {
      calls++;
      return new Promise<void>((resolve) => gates.push(resolve));
    });
    const first = queue();
    const second = queue();
    const third = queue();
    expect(calls).toBe(1);
    expect(third).toBe(second);

    gates[0]();
    await first;
    expect(calls).toBe(2);

    gates[1]();
    await second;
    expect(calls).toBe(2);
  });

  it('保存が失敗しても、次の要求は受け付ける', async () => {
    let calls = 0;
    const queue = createSaveQueue(async () => {
      calls++;
      if (calls === 1) throw new Error('保存できない');
    });
    await queue();
    await queue();
    expect(calls).toBe(2);
  });
});
