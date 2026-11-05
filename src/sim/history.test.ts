import { describe, expect, it } from 'vitest';
import { HISTORY_LIMIT, clear, emptyHistory, push, redo, undo } from './history';

describe('履歴（push・undo・redo・clear）', () => {
  it('積んだ操作を、後のものから取り消せる', () => {
    let h = push(emptyHistory<string>(), 'a');
    h = push(h, 'b');
    const u1 = undo(h);
    expect(u1?.entry).toBe('b');
    const u2 = undo(u1!.history);
    expect(u2?.entry).toBe('a');
    expect(undo(u2!.history)).toBeNull();
  });

  it('取り消した操作は、取り消した順の逆にやり直せる', () => {
    let h = push(emptyHistory<string>(), 'a');
    h = push(h, 'b');
    const u1 = undo(h)!;
    const u2 = undo(u1.history)!;
    const r1 = redo(u2.history);
    expect(r1?.entry).toBe('a');
    const r2 = redo(r1!.history);
    expect(r2?.entry).toBe('b');
    expect(redo(r2!.history)).toBeNull();
  });

  it('新しい操作をすると、やり直しの履歴は消える', () => {
    let h = push(emptyHistory<string>(), 'a');
    h = undo(h)!.history;
    expect(h.future).toEqual(['a']);
    h = push(h, 'c');
    expect(h.future).toEqual([]);
    expect(redo(h)).toBeNull();
  });

  it('50件を超えると、古いものから消える', () => {
    let h = emptyHistory<number>();
    for (let i = 1; i <= HISTORY_LIMIT + 10; i++) h = push(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(11);
    expect(h.past[HISTORY_LIMIT - 1]).toBe(HISTORY_LIMIT + 10);
  });

  it('clear は過去も未来も空にする', () => {
    let h = push(emptyHistory<string>(), 'a');
    h = undo(h)!.history;
    expect(clear<string>()).toEqual({ past: [], future: [] });
    expect(h.future).toHaveLength(1);
  });
});
