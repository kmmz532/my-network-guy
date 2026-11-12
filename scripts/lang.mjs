#!/usr/bin/env node
// 言語ファイル（src/assets/lang/*.json）の道具。基準の言語（ja_jp）と比べて、ほかの言語の足りないキー・余分なキー・
// 置換の名前（{min} など）の食い違いを調べ、全言語のキーをまとめて追加・改名・削除する。
// キーの読み書きは scripts/json.mjs を通す（重複キーの検出と、書式の保持をそちらに任せる）。
//
// 使い方: node scripts/lang.mjs <命令> [引数]
//   status                          言語ごとのキーの数と、足りない・余分・置換の食い違いの件数。食い違いがあれば 1 で終わる
//   missing <言語>                   基準にあって、その言語にないキー（基準の文言を添える）
//   extra <言語>                     その言語にあって、基準にないキー
//   placeholders [言語]              基準と置換の名前が違うキー（省略時は全言語）
//   unused                          ソースのどこからも参照されていないらしい基準のキー（目安。下の注意を見る）
//   add <key> <基準の文言> [--<言語> <文言>]...   全言語に追加する。文言を渡さない言語には追加せず、足りないキーとして残す
//   set <key> <文言> [--lang <言語>]  1つの言語の文言を変える（省略時は基準）
//   rename <old> <new>              全言語でキーの名前を変える
//   del <key>                       全言語からキーを消す
//
// 言語の指定はファイル名の拡張子なし（ja_jp・en_us）。基準は ja_jp。
// unused の注意: tDyn(`contract.${id}.title`) のように組み立てるキーは、テンプレートの固定の部分（`contract.`）を
// 接頭辞として使われているとみなす。それでも漏れる使い方（データの JSON に書いたキーなど）があるため、消す前に grep で確かめる。
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const LANG_DIR = join(ROOT, 'src/assets/lang');
const BASE = 'ja_jp';
const JSON_TOOL = join(ROOT, 'scripts/json.mjs');

const fail = (msg) => {
  console.error(`lang: ${msg}`);
  process.exit(1);
};

const fileOf = (code) => join(LANG_DIR, `${code}.json`);
const codes = () =>
  readdirSync(LANG_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5));

// json.mjs で読む（重複キーがあれば json.mjs が止める）
const json = (...args) => {
  try {
    return execFileSync(process.execPath, [JSON_TOOL, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    fail((e.stderr || e.message).trim());
  }
};

const load = (code) => {
  if (!codes().includes(code)) fail(`言語がない: ${code}（${codes().join('・')}）`);
  json('check', fileOf(code));
  return JSON.parse(readFileSync(fileOf(code), 'utf8'));
};

const placeholdersOf = (text) => [...new Set([...String(text).matchAll(/\{(\w+)\}/g)].map((m) => m[1]))].sort().join(',');

const diff = (code) => {
  const base = load(BASE);
  const other = load(code);
  const missing = Object.keys(base).filter((k) => !Object.hasOwn(other, k));
  const extra = Object.keys(other).filter((k) => !Object.hasOwn(base, k));
  const placeholders = Object.keys(base).filter((k) => Object.hasOwn(other, k) && placeholdersOf(base[k]) !== placeholdersOf(other[k]));
  return { base, other, missing, extra, placeholders };
};

// 名前付きの引数（--en_us 文言）を読む
const options = (args) => {
  const out = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      if (args[i + 1] === undefined) fail(`${args[i]} の値がない`);
      out[args[i].slice(2)] = args[++i];
    } else rest.push(args[i]);
  }
  return { opts: out, rest };
};

const sourceFiles = () => {
  const out = [];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) {
        if (p !== LANG_DIR && f !== 'generated') walk(p);
      } else if (/\.(tsx?|mjs|json)$/.test(f) && !p.startsWith(LANG_DIR)) out.push(p);
    }
  };
  walk(join(ROOT, 'src'));
  walk(join(ROOT, 'scripts'));
  return out;
};

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) fail('命令がない（scripts/lang.mjs の冒頭の使い方を見る）');

switch (cmd) {
  case 'status': {
    const base = load(BASE);
    console.log(`${BASE}（基準）: ${Object.keys(base).length} キー`);
    let bad = 0;
    for (const code of codes().filter((c) => c !== BASE)) {
      const d = diff(code);
      console.log(`${code}: ${Object.keys(d.other).length} キー、足りない ${d.missing.length}、余分 ${d.extra.length}、置換の食い違い ${d.placeholders.length}`);
      bad += d.missing.length + d.extra.length + d.placeholders.length;
    }
    if (codes().length === 1) console.log('ほかの言語はまだない');
    process.exit(bad > 0 ? 1 : 0);
    break;
  }
  case 'missing': {
    const d = diff(args[0] ?? fail('言語がない'));
    for (const k of d.missing) console.log(`${k}\t${d.base[k]}`);
    break;
  }
  case 'extra': {
    const d = diff(args[0] ?? fail('言語がない'));
    for (const k of d.extra) console.log(k);
    break;
  }
  case 'placeholders': {
    const targets = args[0] ? [args[0]] : codes().filter((c) => c !== BASE);
    for (const code of targets) {
      const d = diff(code);
      for (const k of d.placeholders) console.log(`${code}\t${k}\t基準 {${placeholdersOf(d.base[k])}}\t${code} {${placeholdersOf(d.other[k])}}`);
    }
    break;
  }
  case 'unused': {
    const base = load(BASE);
    const text = sourceFiles()
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n');
    // テンプレートの固定の部分（`contract.${id}.title` の `contract.`）を接頭辞として集める
    // 文字列の連結（'guide.' + id）の固定の部分も同じく接頭辞とする
    const prefixes = [...text.matchAll(/`([a-zA-Z0-9_.]+)\$\{/g), ...text.matchAll(/['"]([a-zA-Z0-9_.]+\.)['"]\s*\+/g)]
      .map((m) => m[1])
      .filter((p) => p.includes('.'));
    const used = (k) => text.includes(`'${k}'`) || text.includes(`"${k}"`) || text.includes(`\`${k}\``) || prefixes.some((p) => k.startsWith(p));
    const unused = Object.keys(base).filter((k) => !used(k));
    for (const k of unused) console.log(k);
    console.error(`${unused.length} 件（目安。消す前に grep で確かめる）`);
    break;
  }
  case 'add': {
    const { opts, rest } = options(args);
    const [key, value] = rest;
    if (!key || value === undefined) fail('add <key> <基準の文言> の形で書く');
    for (const code of Object.keys(opts)) if (!codes().includes(code)) fail(`言語がない: ${code}`);
    for (const code of Object.keys(opts)) {
      if (placeholdersOf(opts[code]) !== placeholdersOf(value)) fail(`${code} の置換の名前が基準と違う: {${placeholdersOf(opts[code])}} と {${placeholdersOf(value)}}`);
    }
    process.stdout.write(json('add', fileOf(BASE), key, value));
    for (const [code, text] of Object.entries(opts)) process.stdout.write(json('add', fileOf(code), key, text));
    const left = codes().filter((c) => c !== BASE && !Object.hasOwn(opts, c));
    if (left.length > 0) console.log(`未訳: ${left.join('・')}`);
    break;
  }
  case 'set': {
    const { opts, rest } = options(args);
    const [key, value] = rest;
    const code = opts.lang ?? BASE;
    if (!key || value === undefined) fail('set <key> <文言> の形で書く');
    load(code);
    if (code !== BASE) {
      const base = load(BASE);
      if (!Object.hasOwn(base, key)) fail(`基準にないキー: ${key}（先に基準へ add する）`);
      if (placeholdersOf(base[key]) !== placeholdersOf(value)) fail(`置換の名前が基準と違う: {${placeholdersOf(value)}} と {${placeholdersOf(base[key])}}`);
    }
    process.stdout.write(json('set', fileOf(code), key, value));
    break;
  }
  case 'rename': {
    const [from, to] = args;
    if (!from || !to) fail('rename <old> <new> の形で書く');
    for (const code of codes()) if (Object.hasOwn(load(code), from)) process.stdout.write(`${code}: ${json('rename', fileOf(code), from, to)}`);
    break;
  }
  case 'del': {
    const [key] = args;
    if (!key) fail('del <key> の形で書く');
    for (const code of codes()) if (Object.hasOwn(load(code), key)) process.stdout.write(`${code}: ${json('del', fileOf(code), key)}`);
    break;
  }
  default:
    fail(`知らない命令: ${cmd}`);
}
