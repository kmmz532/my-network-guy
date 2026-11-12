#!/usr/bin/env node
// JSON のファイル（言語ファイル・データ）を、キーの重複を作らずに読み書きする道具。
// Edit で JSON を直接書き換えると、同じキーを2回書いても JSON.parse は後の値を黙って使うため、重複に気付けない。
// この道具は、読み込むときに重複を検出して止め、書き込むときは既存のキーを置き換える。
//
// 使い方: node scripts/json.mjs <命令> <ファイル> [引数]
//   ファイルの略記: lang = src/assets/lang/ja_jp.json、data/<名前> = src/assets/data/<名前>.json
//   キーの書き方: 言語ファイルのような平たいファイルは、キーをそのまま書く（goal.wireless_clients）。
//                 入れ子のファイルは / で区切る（models/0/id）。最上位にそのままのキーがあればそれを優先する。
//
//   get    <file> <key>                  値を JSON で出す。ないときは失敗
//   has    <file> <key>                  あれば 0、なければ 1 で終わる
//   set    <file> <key> <value> [--json] 値を設定する（既存は置き換え、新しいキーは同じ接頭辞のキーの隣に入れる）。--json で value を JSON として読む
//   add    <file> <key> <value> [--json] set と同じだが、既にあれば失敗する（書き間違いの上書きを防ぐ）
//   del    <file> <key>                  キーを消す。ないときは失敗
//   rename <file> <old> <new>            キーの名前を変える（位置は保つ）。new が既にあれば失敗
//   keys   <file> [prefix]               キーの一覧（prefix で始まるものだけ）
//   check  [file...]                     重複キーと書式の崩れを調べる。省略時は lang と src/assets/data 以下の全部
//   dedupe <file>                        重複キーを1つにまとめる。値が違う重複があれば何もせず失敗する
//
// 書き込みは JSON.stringify(…, null, 2) の書式で行う。元のファイルがこの書式でなければ（独自の改行のあるファイル）、
// 書式が崩れるため書き込まずに失敗する。--reformat を付けると書式を整えて書き込む。
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');

const fail = (msg) => {
  console.error(`json: ${msg}`);
  process.exit(1);
};

const pathOf = (name) => {
  if (name === 'lang') return join(ROOT, 'src/assets/lang/ja_jp.json');
  if (name.startsWith('data/') && !name.endsWith('.json')) return join(ROOT, 'src/assets', `${name}.json`);
  return resolve(process.cwd(), name);
};

// 重複キーを探す。JSON の字句を読み、オブジェクトごとに見たキーを覚える。返すのは [{ path, key, line }]
const findDuplicates = (text) => {
  const dups = [];
  let i = 0;
  let line = 1;
  const stack = []; // { keys: Set, path: string[], isObj: boolean, index: number }
  let pendingKey = null;
  const skipWs = () => {
    while (i < text.length && /\s/.test(text[i])) {
      if (text[i] === '\n') line++;
      i++;
    }
  };
  const readString = () => {
    let s = '';
    i++;
    while (text[i] !== '"') {
      if (text[i] === '\\') {
        s += text.slice(i, i + 2);
        i += 2;
      } else s += text[i++];
    }
    i++;
    return JSON.parse(`"${s}"`);
  };
  const childPath = () => {
    const top = stack[stack.length - 1];
    if (!top) return [];
    return [...top.path, top.isObj ? pendingKey : String(top.index)];
  };
  while (i < text.length) {
    skipWs();
    const c = text[i];
    if (c === undefined) break;
    const top = stack[stack.length - 1];
    if (c === '{' || c === '[') {
      stack.push({ keys: new Set(), path: childPath(), isObj: c === '{', index: 0 });
      i++;
    } else if (c === '}' || c === ']') {
      stack.pop();
      i++;
    } else if (c === ',') {
      if (top && !top.isObj) top.index++;
      i++;
    } else if (c === ':') {
      i++;
    } else if (c === '"') {
      const startLine = line;
      const s = readString();
      skipWs();
      if (top && top.isObj && text[i] === ':') {
        if (top.keys.has(s)) dups.push({ path: top.path.join('/'), key: s, line: startLine });
        top.keys.add(s);
        pendingKey = s;
      }
    } else {
      while (i < text.length && !/[\s,}\]]/.test(text[i])) i++;
    }
  }
  return dups;
};

const load = (file, { allowDups = false } = {}) => {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    fail(`読めない: ${file}`);
  }
  const crlf = raw.includes('\r\n');
  const text = raw.replace(/\r\n/g, '\n');
  const dups = findDuplicates(text);
  if (dups.length > 0 && !allowDups) {
    const list = dups.map((d) => `  ${d.line} 行: ${d.path ? `${d.path}/` : ''}${d.key}`).join('\n');
    fail(`${file} に重複キーがある（dedupe で直す）:\n${list}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    fail(`${file} の JSON が壊れている: ${e.message}`);
  }
  return { data, text, crlf, dups, finalNewline: text.endsWith('\n') };
};

// 末尾の改行の有無は元のファイルに合わせる
const format = (data, finalNewline) => `${JSON.stringify(data, null, 2)}${finalNewline ? '\n' : ''}`;

const save = (file, loaded, data) => {
  const reformat = process.argv.includes('--reformat');
  if (!reformat && format(loaded.data, loaded.finalNewline) !== loaded.text) {
    fail(`${file} は標準の書式（2文字の字下げ）ではないため、書き込むと書式が崩れる。--reformat を付けるか、Edit で直す`);
  }
  const out = format(data, loaded.finalNewline);
  writeFileSync(file, loaded.crlf ? out.replace(/\n/g, '\r\n') : out);
};

// キーを解決する。最上位にそのままのキーがあればそれ、なければ / で区切った道筋
const segmentsOf = (data, key) => (Object.hasOwn(data, key) || !key.includes('/') ? [key] : key.split('/'));

const parentOf = (data, segs, create) => {
  let cur = data;
  for (const s of segs.slice(0, -1)) {
    if (cur[s] === undefined) {
      if (!create) return null;
      cur[s] = {};
    }
    if (typeof cur[s] !== 'object' || cur[s] === null) fail(`${segs.join('/')} の途中の ${s} がオブジェクトではない`);
    cur = cur[s];
  }
  return cur;
};

// 新しいキーを、最も長く接頭辞（. 区切り）が一致するキーの集まりの最後の直後に入れた、新しいオブジェクトを返す
const insertNear = (obj, key, value) => {
  const keys = Object.keys(obj);
  const parts = key.split('.');
  let at = keys.length;
  for (let n = parts.length - 1; n > 0; n--) {
    const prefix = `${parts.slice(0, n).join('.')}.`;
    const last = keys.findLastIndex((k) => k.startsWith(prefix));
    if (last >= 0) {
      // 同じ接頭辞の中で辞書順の位置があればそこへ、なければ集まりの最後へ
      const first = keys.findIndex((k) => k.startsWith(prefix));
      const pos = keys.slice(first, last + 1).findIndex((k) => k > key);
      at = pos >= 0 ? first + pos : last + 1;
      break;
    }
  }
  const out = {};
  keys.forEach((k, idx) => {
    if (idx === at) out[key] = value;
    out[k] = obj[k];
  });
  if (at === keys.length) out[key] = value;
  return out;
};

const parseValue = (raw) => {
  if (!process.argv.includes('--json')) return raw;
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`値が JSON ではない: ${e.message}`);
  }
};

const setValue = (file, key, rawValue, mustBeNew) => {
  if (rawValue === undefined) fail('値がない');
  const loaded = load(file);
  const data = structuredClone(loaded.data);
  const segs = segmentsOf(data, key);
  const parent = parentOf(data, segs, true);
  const last = segs[segs.length - 1];
  const exists = Object.hasOwn(parent, last);
  if (mustBeNew && exists) fail(`既にある: ${key} = ${JSON.stringify(parent[last])}`);
  const value = parseValue(rawValue);
  let next = data;
  if (exists || Array.isArray(parent)) parent[last] = value;
  else if (segs.length === 1) next = insertNear(data, last, value);
  else {
    const grand = parentOf(data, segs.slice(0, -1), false);
    const pk = segs[segs.length - 2];
    grand[pk] = insertNear(parent, last, value);
  }
  save(file, loaded, next);
  console.log(`${exists ? '置換' : '追加'}: ${key}`);
};

const allFiles = () => {
  const out = [pathOf('lang')];
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (f.endsWith('.json')) out.push(p);
    }
  };
  walk(join(ROOT, 'src/assets/data'));
  return out;
};

const [cmd, fileArg, ...rest] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!cmd) fail('命令がない（scripts/json.mjs の冒頭の使い方を見る）');

switch (cmd) {
  case 'get':
  case 'has': {
    const { data } = load(pathOf(fileArg));
    const segs = segmentsOf(data, rest[0]);
    const parent = parentOf(data, segs, false);
    const found = parent !== null && Object.hasOwn(parent, segs[segs.length - 1]);
    if (cmd === 'has') process.exit(found ? 0 : 1);
    if (!found) fail(`ない: ${rest[0]}`);
    console.log(JSON.stringify(parent[segs[segs.length - 1]], null, 2));
    break;
  }
  case 'set':
    setValue(pathOf(fileArg), rest[0], rest[1], false);
    break;
  case 'add':
    setValue(pathOf(fileArg), rest[0], rest[1], true);
    break;
  case 'del': {
    const file = pathOf(fileArg);
    const loaded = load(file);
    const data = structuredClone(loaded.data);
    const segs = segmentsOf(data, rest[0]);
    const parent = parentOf(data, segs, false);
    const last = segs[segs.length - 1];
    if (parent === null || !Object.hasOwn(parent, last)) fail(`ない: ${rest[0]}`);
    if (Array.isArray(parent)) parent.splice(Number(last), 1);
    else delete parent[last];
    save(file, loaded, data);
    console.log(`削除: ${rest[0]}`);
    break;
  }
  case 'rename': {
    const [from, to] = rest;
    const file = pathOf(fileArg);
    const loaded = load(file);
    const data = loaded.data;
    if (!Object.hasOwn(data, from)) fail(`ない: ${from}`);
    if (Object.hasOwn(data, to)) fail(`既にある: ${to}`);
    const out = {};
    for (const [k, v] of Object.entries(data)) out[k === from ? to : k] = v;
    save(file, loaded, out);
    console.log(`改名: ${from} → ${to}`);
    break;
  }
  case 'keys': {
    const { data } = load(pathOf(fileArg));
    for (const k of Object.keys(data)) if (!rest[0] || k.startsWith(rest[0])) console.log(k);
    break;
  }
  case 'check': {
    const files = fileArg ? [fileArg, ...rest].map(pathOf) : allFiles();
    let bad = 0;
    for (const file of files) {
      const { dups } = load(file, { allowDups: true });
      for (const d of dups) {
        console.log(`${file}:${d.line}: 重複キー ${d.path ? `${d.path}/` : ''}${d.key}`);
        bad++;
      }
    }
    if (bad > 0) process.exit(1);
    console.log(`重複なし（${files.length} ファイル）`);
    break;
  }
  case 'dedupe': {
    const file = pathOf(fileArg);
    const loaded = load(file, { allowDups: true });
    if (loaded.dups.length === 0) {
      console.log('重複なし');
      break;
    }
    // 値が違う重複は、どちらを残すか決められないため止める。値は行の文字列で比べる（平たいファイルの1行の値を想定）
    const lines = loaded.text.split('\n');
    const seen = new Map();
    const drop = new Set();
    lines.forEach((l, idx) => {
      const m = /^(\s*)"((?:[^"\\]|\\.)*)"\s*:(.*?),?$/.exec(l);
      if (!m) return;
      const id = `${m[1].length}:${m[2]}`;
      if (!seen.has(id)) {
        seen.set(id, m[3].trim());
        return;
      }
      if (seen.get(id) !== m[3].trim()) fail(`値が違う重複がある（手で直す）: ${m[2]}（${idx + 1} 行）`);
      drop.add(idx);
    });
    if (drop.size !== loaded.dups.length) fail('1行で書かれていない重複がある（手で直す）');
    const text = lines.filter((_, idx) => !drop.has(idx)).join('\n');
    // 最後の要素を消したときに残る、閉じ括弧の前の余分なカンマを消す（行の末尾のカンマだけを見る）
    const fixed = text.replace(/,(\n\s*[}\]])/g, '$1');
    JSON.parse(fixed);
    writeFileSync(file, loaded.crlf ? fixed.replace(/\n/g, '\r\n') : fixed);
    console.log(`重複を ${drop.size} 件まとめた`);
    break;
  }
  default:
    fail(`知らない命令: ${cmd}`);
}
