// スマホの配置の判定（M1）。判定は PHONE_QUERY の1か所。幅 768 px 未満、または指の端末で短い辺が 500 px 未満
import { describe, expect, it } from 'vitest';
import { PHONE_QUERY } from './usePhone';

describe('スマホの配置の判定', () => {
  it('幅 768 px 未満と、指の端末の横持ち（短い辺 500 px 未満）を含む', () => {
    expect(PHONE_QUERY).toBe('(max-width: 767px), (pointer: coarse) and (max-height: 499px)');
  });
});
