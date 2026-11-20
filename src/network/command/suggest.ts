// 入力の途中の予測・候補・誤りの位置。登録された命令（COMMANDS）の語の並びから作る。画面は結果を描くだけにする。
// 説明（help）は言語ファイルの鍵で返し、画面と help の命令が翻訳する。
import { portCountOf } from '../../registry/query';
import { ifacePrefixOf } from '../iface';
import { walk, wordsOf, parseLine, specsOf, type Live, type Word } from './parse';
import type { ArgKind, CommandContext, CommandSpec, Token } from './types';

export interface Candidate {
  word: string;
  help: string; // 言語ファイルの鍵
}

export interface Suggestion {
  ghost: string; // 入力の後ろに薄く出す続き
  candidates: readonly Candidate[]; // 次に打てる語（固定の語と、値を出してよいときの引数の値）
  errorAt: number | null; // 文法に合わない語の位置（行の中の文字の位置）
}

// 引数の形（? の一覧に出す。実機と同じく値でなく形だけを出す）
const FORM_OF: Record<ArgKind, string> = {
  iface: '<interface>',
  ip: '<A.B.C.D>',
  mask: '<A.B.C.D>',
  wildcard: '<A.B.C.D>',
  prefix: '<0-32>',
  vlan: '<1-4094>',
  vlanList: '<WORD>',
  area: '<area>',
  asn: '<1-4294967295>',
  vrid: '<1-255>',
  channel: '<channel>',
  ssid: '<WORD>',
  psk: '<WORD>',
  cost: '<1-4294967295>',
  number: '<number>',
  word: '<WORD>',
  hostname: '<WORD>',
  hostOrIp: '<WORD>',
  mac: '<xx:xx:xx:xx:xx:xx>',
};

// 入力を、読み終えた語と、いま打っている語（空白で終わる行は空）に分ける
const splitLine = (line: string): { done: Word[]; typed: Word | null } => {
  const words = wordsOf(line);
  if (words.length === 0 || /\s$/.test(line)) return { done: words, typed: null };
  return { done: words.slice(0, -1), typed: words[words.length - 1] };
};

// 論点が解放されている命令だけに絞る
const visibleSpecs = (ctx: CommandContext): CommandSpec[] => specsOf(ctx.session).filter((spec) => spec.topic === null || ctx.unlocked(spec.topic));

// 引数の位置に出す値の候補。構成から作り、先頭が最も勧める値。作れない型は空
const valuesOf = (token: Extract<Token, { arg: ArgKind }>, previous: string | undefined, ctx: CommandContext): string[] => {
  const { node } = ctx;
  const peerIps = (): string[] => {
    const peers = ctx.links.flatMap((l) => (l.a.node === node.uid ? [l.b.node] : l.b.node === node.uid ? [l.a.node] : []));
    return ctx.nodes.filter((n) => peers.includes(n.uid)).flatMap((n) => n.interfaces.map((i) => i.ip)).filter((ip) => ip !== '');
  };
  switch (token.arg) {
    case 'iface': {
      // まだ設定していない口を先に、設定済みの口を後に並べる
      const prefix = ifacePrefixOf(node.device);
      const names = Array.from({ length: portCountOf(node.device) }, (_, port) => ({ port, name: `${prefix}${port}` }));
      const configured = new Set(node.interfaces.map((i) => i.port));
      return [...names.filter((n) => !configured.has(n.port)), ...names.filter((n) => configured.has(n.port))].map((n) => n.name);
    }
    case 'ip':
      return previous === 'neighbor' || token.name === 'nextHop' || token.name === 'gateway' ? peerIps() : [];
    case 'hostOrIp': {
      const all = ctx.nodes.filter((n) => n.uid !== node.uid).flatMap((n) => n.interfaces.map((i) => i.ip)).filter((ip) => ip !== '');
      return [...new Set([...peerIps(), ...all])];
    }
    default:
      return [];
  }
};

// 次の位置に打てる語の材料。fixed は固定の語、args は引数の位置にある型、ends はここで行を終えられるか
interface Next {
  fixed: Candidate[];
  values: Candidate[];
  forms: Candidate[];
  ends: boolean;
  continues: ReadonlySet<string>; // この位置の固定の語のうち、後ろに語が続く命令があるもの
  typed: string;
  typedAt: number | null;
  broken: { at: number } | null;
}

const nextOf = (line: string, ctx: CommandContext): Next => {
  const { done, typed } = splitLine(line);
  const text = typed?.text ?? '';
  const walked = walk(done, visibleSpecs(ctx));
  const empty: Next = { fixed: [], values: [], forms: [], ends: false, continues: new Set(), typed: text, typedAt: typed?.at ?? null, broken: null };
  if ('error' in walked) return { ...empty, broken: { at: walked.at } };
  const i = done.length;
  const live: Live[] = walked.live;
  // 固定の語ごとに、説明の鍵を決める。その位置で行を終える命令があればその説明、命令が1つならその説明、複数なら語の説明
  const fixed: Candidate[] = [];
  const continues = new Set<string>();
  for (const word of [...new Set(live.flatMap((l) => { const t = l.spec.tokens[i]; return t !== undefined && 'word' in t && t.word.startsWith(text) ? [t.word] : []; }))]) {
    const group = live.filter((l) => { const t = l.spec.tokens[i]; return t !== undefined && 'word' in t && t.word === word; });
    const ender = group.find((l) => l.spec.tokens.length === i + 1);
    const only = new Set(group.map((l) => l.spec.help)).size === 1 ? group[0] : undefined;
    if (group.some((l) => l.spec.tokens.length > i + 1)) continues.add(word);
    fixed.push({ word, help: (ender ?? only)?.spec.help ?? `ui.cmdWord.${word}` });
  }
  const argTokens = live.flatMap((l) => { const t = l.spec.tokens[i]; return t !== undefined && 'arg' in t ? [{ token: t, previous: l.canon[i - 1] }] : []; });
  const values: Candidate[] = [];
  const forms: Candidate[] = [];
  for (const { token, previous } of argTokens) {
    if (!ctx.hideValues) {
      for (const word of valuesOf(token, previous, ctx)) {
        if (word.startsWith(text) && !values.some((v) => v.word === word)) values.push({ word, help: `ui.cmdArg.${token.arg}` });
      }
    }
    if (!forms.some((f) => f.word === FORM_OF[token.arg])) forms.push({ word: FORM_OF[token.arg], help: `ui.cmdArg.${token.arg}` });
  }
  return { ...empty, fixed, values, forms, continues, ends: live.some((l) => l.spec.tokens.length === i) };
};

// 履歴の行が、いまのモードで文法に合い、論点が解放されているか
const fitsGrammar = (entry: string, ctx: CommandContext): boolean => {
  const parsed = parseLine(entry, ctx.session);
  return parsed !== null && 'spec' in parsed && (parsed.spec.topic === null || ctx.unlocked(parsed.spec.topic));
};

// 薄い文字の予測。履歴（新しいものが後ろ）を先に、なければ文法から。空の入力には出さない
const ghostOf = (line: string, next: Next, ctx: CommandContext, history: readonly string[]): string => {
  if (line.trim() === '') return '';
  for (let i = history.length - 1; i >= 0; i--) {
    const entry = history[i];
    if (entry.length > line.length && entry.startsWith(line) && fitsGrammar(entry, ctx)) return entry.slice(line.length);
  }
  if (next.broken !== null) return '';
  if (next.fixed.length === 1 && next.values.length === 0) {
    const [{ word }] = next.fixed;
    if (word === next.typed) return '';
    return `${word.slice(next.typed.length)}${next.continues.has(word) ? ' ' : ''}`;
  }
  if (next.fixed.length === 0 && next.values.length > 0) return `${next.values[0].word.slice(next.typed.length)} `;
  return '';
};

// 打っている語が、どの命令の語の並びにも合わないとき、その位置。引数の位置は途中の語を誤りにしない
const errorAtOf = (line: string, ctx: CommandContext): number | null => {
  const { done, typed } = splitLine(line);
  const walked = walk(done, specsOf(ctx.session));
  if ('error' in walked) return walked.at;
  if (typed === null) return null;
  const i = done.length;
  const fits = walked.live.some((l) => {
    const token = l.spec.tokens[i];
    return token !== undefined && ('arg' in token || token.word.startsWith(typed.text));
  });
  return fits ? null : typed.at;
};

export const suggest = (line: string, ctx: CommandContext, history: readonly string[]): Suggestion => {
  const next = nextOf(line, ctx);
  return {
    ghost: ghostOf(line, next, ctx, history),
    candidates: [...next.fixed, ...next.values],
    errorAt: errorAtOf(line, ctx),
  };
};

// ? と help の一覧。次に打てる語と、引数の形、行をここで終えられるときの <cr>
export const questionList = (line: string, ctx: CommandContext): readonly Candidate[] => {
  const next = nextOf(line, ctx);
  return [...next.fixed, ...next.values, ...next.forms, ...(next.ends && next.typed === '' ? [{ word: '<cr>', help: 'ui.cmdArg.cr' }] : [])];
};

// 候補の語を、いま打っている語の代わりに入れた行（確定の空白は付けない）
export const withWord = (line: string, word: string): string => {
  const { typed } = splitLine(line);
  return typed === null ? `${line}${word}` : `${line.slice(0, typed.at)}${word}`;
};

// ? と help の出力の行（語を揃えて、説明を右に並べる）
export const questionLines = (list: readonly Candidate[], tr: (key: string) => string): string[] => {
  const width = Math.max(0, ...list.map((c) => c.word.length));
  return list.map((c) => `  ${c.word.padEnd(width)}  ${tr(c.help)}`);
};
