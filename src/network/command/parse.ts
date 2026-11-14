// 入力の行を、登録された命令（COMMANDS）の1つに当てはめる。語を1つずつ、今のモードの命令の語の並びに突き合わせて絞る。
// 固定の語は、その位置で一意に決まるときに略記（conf t・int g0/1・sh ip ro）を展開する。
import { isArg } from './args';
import { COMMANDS } from './registry';
import type { CommandSpec, Token, TerminalSession } from './types';

// invalid は、解釈できない語。ambiguous は、一意に決まらない略記。incomplete は、ここまでは合っていて語が足りない行。
// line は、略記を展開した正式な形（語を空白1つで区切る）
export type ParseResult =
  | { spec: CommandSpec; args: Record<string, string>; line: string }
  | { error: 'invalid' | 'ambiguous'; at: number }
  | { error: 'incomplete' };

// 語と、その語が行のどこから始まるか
export interface Word {
  text: string;
  at: number;
}

export const wordsOf = (line: string): Word[] => [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: m.index }));

// 突き合わせの途中の命令。tokens の何番目まで読んだかは、語の位置と同じ。canon は、略記を展開した語
export interface Live {
  spec: CommandSpec;
  args: Record<string, string>;
  canon: string[];
}

// 語が、命令の語の並びの i 番目に合うか。exact は固定の語と同じ、prefix は固定の語の頭と同じ、value は型・残りの語に合う
const kindOf = (token: Token | undefined, text: string): 'exact' | 'prefix' | 'value' | null => {
  if (token === undefined) return null;
  if ('word' in token) return token.word === text ? 'exact' : token.word.startsWith(text) ? 'prefix' : null;
  return isArg(token.arg, text) ? 'value' : null;
};

// 語を先頭から読み進め、読み終えた時点で残る命令を返す。読めない語があれば、その位置の誤りを返す。
// specs は、読み始めの候補（今のモードの命令。論点の解放で絞るときは、呼ぶ側で絞る）
export const walk = (words: readonly Word[], specs: readonly CommandSpec[]): { live: Live[] } | { error: 'invalid' | 'ambiguous'; at: number } => {
  let live: Live[] = specs.map((spec) => ({ spec, args: {}, canon: [] }));
  for (const [i, word] of words.entries()) {
    const kinds = live.map((l) => kindOf(l.spec.tokens[i], word.text));
    // 優先は、固定の語と同じ > 型・残りの語 > 略記（頭が同じ）
    const pick = (kind: 'exact' | 'prefix' | 'value'): Live[] => live.filter((_, n) => kinds[n] === kind);
    let next = pick('exact');
    if (next.length === 0) next = pick('value');
    if (next.length === 0) {
      next = pick('prefix');
      const candidates = new Set(next.map((l) => (l.spec.tokens[i] as { word: string }).word));
      if (candidates.size > 1) return { error: 'ambiguous', at: word.at };
    }
    if (next.length === 0) return { error: 'invalid', at: word.at };
    live = next.map((l) => {
      const token = l.spec.tokens[i];
      return 'arg' in token
        ? { ...l, args: { ...l.args, [token.name]: word.text }, canon: [...l.canon, word.text] }
        : { ...l, canon: [...l.canon, token.word] };
    });
  }
  return { live };
};

export const specsOf = (session: TerminalSession): CommandSpec[] => COMMANDS.all().filter((spec) => spec.modes.includes(session.mode));

// 空の行は null。それ以外は、命令に当てはまるか誤りを返す
export const parseLine = (line: string, session: TerminalSession): ParseResult | null => {
  const words = wordsOf(line);
  if (words.length === 0) return null;
  const walked = walk(words, specsOf(session));
  if ('error' in walked) return walked;
  // 語を読み終えた。残りの語がない命令に当てはまる
  for (const l of walked.live) {
    if (l.spec.tokens.length === words.length) return { spec: l.spec, args: l.args, line: l.canon.join(' ') };
  }
  return { error: 'incomplete' };
};
