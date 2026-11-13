import { describe, expect, it } from 'vitest';
import { Registry, UnknownIdError } from './registry';

describe('Registry', () => {
  it('登録した定義を引ける', () => {
    const r = new Registry<{ id: string; n: number }>('試験');
    r.register({ id: 'a', n: 1 });
    expect(r.get('a').n).toBe(1);
    expect(r.has('a')).toBe(true);
    expect(r.has('b')).toBe(false);
    expect(r.all()).toHaveLength(1);
  });
  it('同じ ID の登録・未知の ID の取得は例外', () => {
    const r = new Registry<{ id: string }>('試験');
    r.register({ id: 'a' });
    expect(() => r.register({ id: 'a' })).toThrow();
    expect(() => r.get('x')).toThrow(UnknownIdError);
  });
  it('凍結の後は登録できない', () => {
    const r = new Registry<{ id: string }>('試験');
    r.freeze();
    expect(() => r.register({ id: 'a' })).toThrow();
  });
});
