// 検索の文字の正規化（N67）のテスト
import { describe, expect, it } from 'vitest';
import { matchesQuery, normalizeQuery } from './search';

describe('検索の文字の正規化', () => {
  it('ひらがなとカタカナを同じものとして比べる', () => {
    expect(normalizeQuery('ルーター')).toBe(normalizeQuery('るーたー'));
    expect(normalizeQuery('ハブ')).toBe('はぶ');
  });

  it('全角と半角を同じものとして比べる（英数字・記号・半角カナ）', () => {
    expect(normalizeQuery('ＰＣ')).toBe('pc');
    expect(normalizeQuery('pc')).toBe('pc');
    expect(normalizeQuery('ｽｲｯﾁ')).toBe(normalizeQuery('スイッチ'));
    expect(normalizeQuery('ＬＡＮ－２')).toBe('lan-2');
  });

  it('大文字と小文字、前後と間の空白を区別しない', () => {
    expect(normalizeQuery('  Server   Basic ')).toBe('server basic');
  });

  it('濁点・半濁点はそのまま区別する（ゲーム内の名前の違いを消さない）', () => {
    expect(normalizeQuery('ばん')).not.toBe(normalizeQuery('はん'));
  });
});

describe('検索の一致', () => {
  it('空の検索は、どの項目にも一致する', () => {
    expect(matchesQuery('', ['PC'])).toBe(true);
    expect(matchesQuery('   ', [])).toBe(true);
  });

  it('いずれかの項目に含まれれば一致する（名前・ID・分類）', () => {
    const fields = ['L2スイッチ（8ポート）', 'l2_switch_8p', 'スイッチ'];
    expect(matchesQuery('すいっち', fields)).toBe(true);
    expect(matchesQuery('8P', fields)).toBe(true);
    expect(matchesQuery('l2_switch', fields)).toBe(true);
    expect(matchesQuery('ルーター', fields)).toBe(false);
  });
});

describe('ローマ字での検索', () => {
  it('ローマ字で、ひらがなの読みの項目に一致する', () => {
    expect(matchesQuery('sui', ['すいか'])).toBe(true);
    expect(matchesQuery('ko-hi-', ['こーひーめーかー'])).toBe(true);
    expect(matchesQuery('suit', ['すいち'])).toBe(true);
    expect(matchesQuery('suit', ['さーば'])).toBe(false);
  });

  it('ID や英語名の照合は今までどおり残す', () => {
    expect(matchesQuery('pc', ['事務用PC', 'pc_basic'])).toBe(true);
    expect(matchesQuery('l2_switch', ['l2_switch_8p'])).toBe(true);
  });
});
