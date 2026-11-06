import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STAFF_LOOKS, staffSpriteName } from './schema';

describe('社員の見た目', () => {
  it('25 通りあり（服×髪×髪型の 24 通りと紫の長髪）、どれも重ならない', () => {
    expect(STAFF_LOOKS).toHaveLength(25);
    expect(new Set(STAFF_LOOKS).size).toBe(25);
  });

  it('すべての見た目に 2 コマのスプライトがある', () => {
    const dir = join(__dirname, '..', 'assets', 'sprites', 'staff');
    for (const look of STAFF_LOOKS) {
      for (const frame of [0, 1]) {
        expect(existsSync(join(dir, `${staffSpriteName(look)}_${frame}.png`))).toBe(true);
      }
    }
  });

  it('増やす前の blue・red は黒髪の短髪として描く', () => {
    expect(staffSpriteName('blue')).toBe('blue_dark_short');
    expect(staffSpriteName('red')).toBe('red_dark_short');
    expect(staffSpriteName('green_brown_long')).toBe('green_brown_long');
  });
});
