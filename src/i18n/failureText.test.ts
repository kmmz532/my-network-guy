import { describe, expect, it } from 'vitest';
import langJson from '../assets/lang/ja_jp.json';
import { FAILURE_REASONS } from '../network/types';

// 言語ファイルのキーを列挙して照合する（キーに「.」を含むため、プロパティのパスでは引かない）
const dict = langJson as Record<string, string>;
const keys = Object.keys(dict);

describe('失敗の理由の文言', () => {
  it('すべての失敗の理由に、文言（error.<理由>）と直し方（error.<理由>.fix）がある', () => {
    for (const reason of FAILURE_REASONS) {
      expect(keys).toContain(`error.${reason}`);
      expect(keys).toContain(`error.${reason}.fix`);
    }
  });

  it('言語ファイルの error. の文言は、すべて直し方を持つ', () => {
    const messages = keys.filter((k) => k.startsWith('error.') && !k.endsWith('.fix'));
    expect(messages.length).toBeGreaterThan(0);
    for (const key of messages) expect(keys).toContain(`${key}.fix`);
  });

  it('直し方は2〜3行で、空でない', () => {
    for (const reason of FAILURE_REASONS) {
      const lines = dict[`error.${reason}.fix`].split('\n');
      expect(lines.length, reason).toBeGreaterThanOrEqual(2);
      expect(lines.length, reason).toBeLessThanOrEqual(3);
      expect(lines.every((line) => line.trim() !== ''), reason).toBe(true);
    }
  });

  it('言語ファイルに、失敗の理由にない error. の文言はない', () => {
    const messages = keys.filter((k) => k.startsWith('error.') && !k.endsWith('.fix')).map((k) => k.slice('error.'.length));
    expect(messages.sort()).toEqual([...FAILURE_REASONS].sort());
  });
});
