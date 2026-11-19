import { describe, expect, it } from 'vitest';
import { nextPlayIndex } from './sequencePlay';

describe('nextPlayIndex', () => {
  it('上の行から1行ずつ進み、最後の行の次で止まる', () => {
    expect(nextPlayIndex(null, 3)).toBe(0);
    expect(nextPlayIndex(0, 3)).toBe(1);
    expect(nextPlayIndex(1, 3)).toBe(2);
    expect(nextPlayIndex(2, 3)).toBeNull();
    expect(nextPlayIndex(null, 0)).toBeNull();
  });
});
