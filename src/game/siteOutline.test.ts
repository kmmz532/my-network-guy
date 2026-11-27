// 現場の枠の外周。左右と手前の壁は上面（cap）の外側、奥の壁は上端に枠が来る。L 字の部屋では、何もない場所を囲まない
import { describe, expect, it } from 'vitest';
import type { GameMap } from '../data/schema';
import { siteOutlineOf } from './siteOutline';

const TS = 10;
const CAP = 2;
const mapOf = (tiles: string[]): GameMap =>
  ({ id: 't', width: tiles[0].length, height: tiles.length, tileSize: TS, floor: 'wood', legend: { '.': 'floor', '#': 'wall', ' ': 'void' }, tiles }) as unknown as GameMap;

describe('siteOutlineOf', () => {
  it('長方形の部屋は、左右と手前は壁の上面の外側、奥は壁の上端に枠が来る', () => {
    const segs = siteOutlineOf(mapOf(['####', '#..#', '#..#', '####']), CAP);
    const xs = segs.flatMap((s) => [s.x1, s.x2]);
    const ys = segs.flatMap((s) => [s.y1, s.y2]);
    // 左の壁は右端の cap、右の壁は左端の cap だけが見える
    expect(Math.min(...xs)).toBe(TS - CAP);
    expect(Math.max(...xs)).toBe(3 * TS + CAP);
    // 奥の壁は全体（上端 0）、手前の壁は上端の cap だけが見える
    expect(Math.min(...ys)).toBe(0);
    expect(Math.max(...ys)).toBe(3 * TS + CAP);
  });

  it('L 字の部屋は、何もない場所（右下）を囲まない', () => {
    const segs = siteOutlineOf(mapOf(['#####', '#...#', '#.###', '#.#  ', '###  ']), CAP);
    // 何もない場所（右下）の中には線を引かない
    expect(segs.every((s) => !(Math.min(s.x1, s.x2) >= 3 * TS && Math.min(s.y1, s.y2) >= 3 * TS + CAP))).toBe(true);
  });
});
