// ローマ字からひらがなへの変換（検索用）
import { describe, expect, it } from 'vitest';
import { romajiCandidates, romajiToKana } from './romaji';

describe('ローマ字からひらがな', () => {
  it('基本の音（ヘボン式と訓令式の両方）', () => {
    expect(romajiToKana('sushi').kana).toBe('すし');
    expect(romajiToKana('susi').kana).toBe('すし');
    expect(romajiToKana('tsuchi').kana).toBe('つち');
    expect(romajiToKana('tutiti').kana).toBe('つちち');
    expect(romajiToKana('fuji').kana).toBe('ふじ');
  });

  it('拗音', () => {
    expect(romajiToKana('kyoto').kana).toBe('きょと');
    expect(romajiToKana('shacho').kana).toBe('しゃちょ');
  });

  it('促音（同じ子音の連続）', () => {
    expect(romajiToKana('katta').kana).toBe('かった');
    expect(romajiToKana('kippu').kana).toBe('きっぷ');
  });

  it('撥音（n・nn・n'+"'"+'、子音の前の n）', () => {
    expect(romajiToKana('shinbun').kana).toBe('しんぶん');
    expect(romajiToKana('konnichi').kana).toBe('こんにち');
    expect(romajiToKana("kin'en").kana).toBe('きんえん');
  });

  it('長音の -', () => {
    expect(romajiToKana('ko-hi-').kana).toBe('こーひー');
  });

  it('最後の子音は確定せず、残りとして返す（suit の t）', () => {
    expect(romajiToKana('suit')).toEqual({ kana: 'すい', pending: 't' });
  });

  it('未確定の子音の候補は、その子音で始まる仮名になる', () => {
    // t で始まる仮名（た・ち・つ・て・と）。拗音（ちゃ・ちゅ・ちょ）も続きとして残る
    expect(romajiCandidates('suit')).toEqual(['すいた', 'すいち', 'すいつ', 'すいて', 'すいと', 'すいちゃ', 'すいちゅ', 'すいちょ']);
    expect(romajiCandidates('sui')).toEqual(['すい']);
  });
});
