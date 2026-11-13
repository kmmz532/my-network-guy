// 失敗の理由と用語集の対応: 対応先の用語が言語ファイルにあること
import { describe, expect, it } from 'vitest';
import langJson from '../assets/lang/ja_jp.json';
import { GLOSSARY_OF_FAILURE } from './glossaryOf';

const dict = langJson as Record<string, string>;

describe('失敗の理由と用語集', () => {
  it('対応する用語は、言語ファイルの glossary.<ID> にある', () => {
    for (const [reason, id] of Object.entries(GLOSSARY_OF_FAILURE)) {
      expect(dict[`glossary.${id}`], reason).toBeTruthy();
    }
  });
});
