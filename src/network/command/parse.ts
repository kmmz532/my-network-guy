// 入力の行を、登録された命令（COMMANDS）の1つに当てはめる。語の並びが合う命令を、今のモードのものから探す。
import { COMMANDS } from './registry';
import type { CommandSpec, TerminalSession } from './types';

// 略記を展開する表。語の位置（それまでの語）ごとに、続けられる固定の語を並べる。ここにある語だけを展開する
export const LEGACY_ABBREV: Record<string, string[]> = {
  '': ['help', 'show', 'ping', 'traceroute', 'ip', 'no', 'hostname', 'clear'],
  show: ['ip', 'interfaces', 'running-config', 'mac'],
  'show mac': ['address-table'],
  'show ip': ['route', 'ospf', 'nat'],
  'show ip nat': ['translations'],
  'show ip rip': ['database'],
  'show ip ospf': ['neighbor'],
  ip: ['address', 'default-gateway', 'route'],
  no: ['ip', 'hostname'],
  'no ip': ['default-gateway', 'route'],
};

export type ParseResult =
  | { spec: CommandSpec; args: Record<string, string> }
  | { error: 'invalid' | 'ambiguous'; at: number };

// 語と、その語が行のどこから始まるか
interface Word {
  text: string;
  at: number;
}

const wordsOf = (line: string): Word[] => [...line.matchAll(/\S+/g)].map((m) => ({ text: m[0], at: m.index }));

// 略記を正式な語に直す。語が一意に決まるときだけ展開し、決まらない語があればその位置を返す。表にない語は、そのまま残す
const expand = (words: Word[]): { words: Word[] } | { ambiguousAt: number } => {
  const expanded: Word[] = [];
  let context = '';
  for (const word of words) {
    const candidates = (LEGACY_ABBREV[context] ?? []).filter((w) => w.startsWith(word.text));
    if (candidates.includes(word.text)) {
      expanded.push(word);
      context = context === '' ? word.text : `${context} ${word.text}`;
    } else if (candidates.length === 1) {
      expanded.push({ text: candidates[0], at: word.at });
      context = context === '' ? candidates[0] : `${context} ${candidates[0]}`;
    } else if (candidates.length > 1) {
      return { ambiguousAt: word.at };
    } else {
      // 表にない語（機器の名前・アドレスなど）は、そのまま残す。以降は表で展開しない
      expanded.push(word);
      context = '\u0000';
    }
  }
  return { words: expanded };
};

// 命令の語の並びと、行の語を突き合わせる。合えば引数（{ rest } は残りの語を空白でつないだもの）を返す
const match = (spec: CommandSpec, words: readonly Word[]): Record<string, string> | null => {
  const args: Record<string, string> = {};
  let i = 0;
  for (const token of spec.tokens) {
    if ('word' in token) {
      if (words[i]?.text !== token.word) return null;
      i += 1;
    } else if ('rest' in token) {
      args[token.rest] = words.slice(i).map((w) => w.text).join(' ');
      i = words.length;
    } else {
      throw new Error(`型のある引数は未対応: ${spec.id}`);
    }
  }
  return i === words.length ? args : null;
};

// 木で解釈できない行は null を返す
export const parseLine = (line: string, session: TerminalSession): ParseResult | null => {
  const expanded = expand(wordsOf(line));
  for (const spec of COMMANDS.all()) {
    if (!spec.modes.includes(session.mode)) continue;
    const words = 'ambiguousAt' in expanded ? null : expanded.words;
    if (words === null) continue;
    const args = match(spec, words);
    if (args !== null) return { spec, args };
  }
  if ('ambiguousAt' in expanded) return { error: 'ambiguous', at: expanded.ambiguousAt };
  return null;
};
