// 向き（N95）: 絵の名前・回す順・絵が実際にあること
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { FACINGS, rotateFacing, spriteNameOf } from './facing';

const SPRITES = join(process.cwd(), 'src', 'assets', 'sprites');

describe('向き（N95）', () => {
  it('up は今の絵の名前のまま、ほかは _front・_left・_right を付ける', () => {
    expect(spriteNameOf('furniture/desk', 'up')).toBe('furniture/desk');
    expect(spriteNameOf('furniture/desk', 'down')).toBe('furniture/desk_front');
    expect(spriteNameOf('furniture/chair', 'left')).toBe('furniture/chair_left');
    expect(spriteNameOf('device/pc_basic', 'right')).toBe('device/pc_basic_right');
  });

  it('机・椅子・PC は、どの向きの絵もある', () => {
    for (const base of ['furniture/desk', 'furniture/chair', 'device/pc_basic']) {
      for (const facing of FACINGS) {
        expect(existsSync(join(SPRITES, `${spriteNameOf(base, facing)}.png`))).toBe(true);
      }
    }
  });

  it('時計回りに4回回すと元に戻る', () => {
    expect(rotateFacing('up')).toBe('right');
    expect(rotateFacing('right')).toBe('down');
    expect(rotateFacing('down')).toBe('left');
    expect(rotateFacing('left')).toBe('up');
  });

  it('不正な向きは例外にする', () => {
    expect(() => spriteNameOf('furniture/desk', 'north' as never)).toThrow();
  });
});
