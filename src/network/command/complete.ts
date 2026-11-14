// 入力の行の補完（Tab）。次に打てる語（suggest の候補）から、今の入力の続きを探す。
import { suggest, withWord } from './suggest';
import { wordsOf } from './parse';
import type { CommandContext } from './types';

// 打っている語の頭と同じ候補が1つなら続きを書き足して末尾に空白を付け、複数なら共通の続きまで書き足す。候補がなければ変えない
export const completeLine = (line: string, ctx: CommandContext): string => {
  const words = suggest(line, ctx, []).candidates.map((c) => c.word);
  if (words.length === 0) return line;
  if (words.length === 1) return `${withWord(line, words[0])} `;
  const common = words.reduce((a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  });
  const typed = /\s$/.test(line) ? '' : (wordsOf(line).at(-1)?.text ?? '');
  return common.length > typed.length ? withWord(line, common) : line;
};
