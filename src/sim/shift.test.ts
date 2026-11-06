// 勤務の区分（N48）。夜勤は 21時〜翌6時、日をまたぐ。出社は 20時30分
import { describe, expect, it } from 'vitest';
import balanceJson from '../assets/data/balance.json';
import type { Balance } from '../data/schema';
import { isOnShift, isPresentOnShift } from './shift';

const balance = balanceJson as unknown as Balance;
const h = (hour: number, min = 0) => hour * 60 + min;

describe('勤務の区分（夜勤）', () => {
  it('夜勤の 23時と 3時は勤務中、7時と 12時は勤務外', () => {
    expect(isOnShift(h(23), 'night', balance)).toBe(true);
    expect(isOnShift(h(3), 'night', balance)).toBe(true);
    expect(isOnShift(h(7), 'night', balance)).toBe(false);
    expect(isOnShift(h(12), 'night', balance)).toBe(false);
  });

  it('日勤の 12時は勤務中、夜の 23時は勤務外', () => {
    expect(isOnShift(h(12), 'day', balance)).toBe(true);
    expect(isOnShift(h(23), 'day', balance)).toBe(false);
  });

  it('夜勤は 20時30分に出社し、6時に席を立つ（6時までは事務所にいる）', () => {
    expect(isPresentOnShift(h(20, 30), 'night', balance)).toBe(true);
    expect(isPresentOnShift(h(20), 'night', balance)).toBe(false);
    expect(isPresentOnShift(h(5, 59), 'night', balance)).toBe(true);
    expect(isPresentOnShift(h(6), 'night', balance)).toBe(false);
  });
});
