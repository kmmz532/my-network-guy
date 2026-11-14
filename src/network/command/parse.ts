// 入力の行を、登録された命令（COMMANDS）の1つに当てはめる。語を1つずつ、今のモードの命令の語の並びに突き合わせて絞る。
// 固定の語は、その位置で一意に決まるときに略記（conf t・int g0/1・sh ip ro）を展開する。
import { isArg } from './args';
import { COMMANDS } from './registry';
import type { CommandSpec, Token, TerminalSession } from './types';

// invalid は、解釈できない語（語が足りない行は、行末の次の位置）。ambiguous は、一意に決まらない略記
export type ParseResult =
  | { spec: CommandSpec; args: Record<string, string> }
  | { error: 'invalid' | 'ambiguous'; at: number };

// 語と、その語が行のどこから始まるか
interface Word {
  text: string;
  at: number;
}

const wordsOf = (line: string): Word[] => [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: m.index }));

// 突き合わせの途中の命令。tokens の何番目まで読んだかは、語の位置と同じ（{ rest } は残りをすべて読んで終わる）
interface Live {
  spec: CommandSpec;
  args: Record<string, string>;
  done: boolean; // { rest } で残りを読み終えた
}

// 語が、命令の語の並びの i 番目に合うか。exact は固定の語と同じ、prefix は固定の語の頭と同じ、value は型・残りの語に合う
const kindOf = (token: Token | undefined, text: string): 'exact' | 'prefix' | 'value' | null => {
  if (token === undefined) return null;
  if ('word' in token) return token.word === text ? 'exact' : token.word.startsWith(text) ? 'prefix' : null;
  if ('rest' in token) return 'value';
  return isArg(token.arg, text) ? 'value' : null;
};

// 空の行は null。それ以外は、命令に当てはまるか誤りの位置を返す
export const parseLine = (line: string, session: TerminalSession): ParseResult | null => {
  const words = wordsOf(line);
  if (words.length === 0) return null;
  let live: Live[] = COMMANDS.all().filter((spec) => spec.modes.includes(session.mode)).map((spec) => ({ spec, args: {}, done: false }));
  for (const [i, word] of words.entries()) {
    const kinds = live.map((l) => (l.done ? 'value' : kindOf(l.spec.tokens[i], word.text)));
    // 優先は、固定の語と同じ > 型・残りの語 > 略記（頭が同じ）
    const pick = (kind: 'exact' | 'prefix' | 'value'): Live[] => live.filter((_, n) => kinds[n] === kind);
    let next = pick('exact');
    if (next.length === 0) next = pick('value');
    let text = word.text;
    if (next.length === 0) {
      next = pick('prefix');
      const candidates = new Set(next.map((l) => (l.spec.tokens[i] as { word: string }).word));
      if (candidates.size > 1) return { error: 'ambiguous', at: word.at };
      if (candidates.size === 1) [text] = candidates;
    }
    if (next.length === 0) return { error: 'invalid', at: word.at };
    live = next.map((l) => {
      if (l.done) return l;
      const token = l.spec.tokens[i];
      if ('arg' in token) return { ...l, args: { ...l.args, [token.name]: text } };
      if ('rest' in token) return { ...l, args: { ...l.args, [token.rest]: words.slice(i).map((w) => w.text).join(' ') }, done: true };
      return l;
    });
  }
  // 語を読み終えた。残りの語がない（または { rest } だけ）の命令に当てはまる
  for (const l of live) {
    const left = l.done ? [] : l.spec.tokens.slice(words.length);
    if (left.length === 0) return { spec: l.spec, args: l.args };
    if (left.length === 1 && 'rest' in left[0]) return { spec: l.spec, args: { ...l.args, [left[0].rest]: '' } };
  }
  return { error: 'invalid', at: line.trimEnd().length + 1 };
};
