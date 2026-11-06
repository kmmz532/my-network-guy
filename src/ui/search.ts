// 検索の文字の正規化と一致の判定（N67）。ショップとインベントリで使う。
// 全角と半角（NFKC）をそろえ、カタカナをひらがなに直し、大文字と小文字・前後と間の空白の違いを区別しない。
import { romajiCandidates } from './romaji';

const KATAKANA_START = 0x30a1; // ァ
const KATAKANA_END = 0x30f6; // ヶ
const KANA_SHIFT = 0x60;

export const normalizeQuery = (text: string): string =>
  text
    .normalize('NFKC')
    .replace(/[\u30a1-\u30f6]/g, (c) => {
      const code = c.charCodeAt(0);
      return code >= KATAKANA_START && code <= KATAKANA_END ? String.fromCharCode(code - KANA_SHIFT) : c;
    })
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();

// 検索の文字が、いずれかの項目（名前・ID・分類など）に含まれるか。空の検索は全部に一致する
// ローマ字（半角の英字）を含むときは、ひらがなに直した候補でも照合する。元の文字（ID・英語名）の照合も残す
export const matchesQuery = (query: string, fields: readonly string[]): boolean => {
  const q = normalizeQuery(query);
  if (q === '') return true;
  const candidates = /[a-z]/.test(q) ? [q, ...romajiCandidates(q)] : [q];
  return fields.some((field) => {
    const f = normalizeQuery(field);
    return candidates.some((c) => f.includes(c));
  });
};
