import { describe, expect, it } from 'vitest';
import langJson from '../assets/lang/ja_jp.json';
import { FAILURE_REASONS } from '../network/types';
import { OP_FAIL_REASONS } from '../sim/failReason';

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

  it('直し方は1行で、空でない', () => {
    for (const reason of FAILURE_REASONS) {
      const text = dict[`error.${reason}.fix`];
      expect(text.includes('\n'), reason).toBe(false);
      expect(text.trim() !== '', reason).toBe(true);
    }
  });

  it('言語ファイルに、失敗の理由にない error. の文言はない', () => {
    const messages = keys.filter((k) => k.startsWith('error.') && !k.endsWith('.fix')).map((k) => k.slice('error.'.length));
    expect(messages.sort()).toEqual([...FAILURE_REASONS].sort());
  });
});

describe('操作の失敗の理由の文言', () => {
  it('すべての操作の失敗の理由に、文言（ui.error.<理由>）がある', () => {
    for (const reason of OP_FAIL_REASONS) expect(keys, reason).toContain(`ui.error.${reason}`);
  });

  it('理由に重複がない', () => {
    expect(new Set(OP_FAIL_REASONS).size).toBe(OP_FAIL_REASONS.length);
  });
});
