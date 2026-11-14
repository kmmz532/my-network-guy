// 入力の行の補完。登録された命令（COMMANDS）の固定の語から、今の入力の続きを探す。
import { COMMANDS } from './registry';
import type { CommandContext } from './types';

// 候補が1つなら続きを書き足して末尾に空白を付け、複数なら共通の続きまで書き足す。候補がなければ変えない
export const completeLine = (line: string, ctx: CommandContext): string => {
  const trimmedStart = line.replace(/^\s+/, '');
  const endsWithSpace = /\s$/.test(trimmedStart);
  const words = trimmedStart.trim().split(/\s+/).filter((w) => w !== '');
  const typed = endsWithSpace || words.length === 0 ? '' : words[words.length - 1];
  const before = endsWithSpace || words.length === 0 ? words : words.slice(0, -1);
  const candidates = new Set<string>();
  for (const spec of COMMANDS.all()) {
    if (!spec.modes.includes(ctx.session.mode)) continue;
    if (spec.topic !== null && !ctx.unlocked(spec.topic)) continue;
    const next = spec.tokens[before.length];
    if (next === undefined || !('word' in next) || !next.word.startsWith(typed)) continue;
    if (before.every((w, i) => { const token = spec.tokens[i]; return 'word' in token && token.word === w; })) candidates.add(next.word);
  }
  if (candidates.size === 0) return line;
  const list = [...candidates];
  const common = list.reduce((a, b) => {
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return a.slice(0, i);
  });
  const base = trimmedStart.slice(0, trimmedStart.length - typed.length);
  if (list.length === 1) return `${base}${list[0]} `;
  if (common.length > typed.length) return `${base}${common}`;
  return line;
};
