#!/usr/bin/env node
// 仕様（memo/NET.md）とコードの突き合わせ。どちらか片方にしかない ID を一覧にする。
// 突き合わせるもの:
//   1. §6 の失敗と警告の表の ID ↔ コードの失敗の ID（src/network/types.ts の FAILURE_REASONS）・警告の ID（src/network/query/warnings.ts の VlanWarning）。
//      コードの失敗と警告は、言語ファイルの error.<ID>・error.<ID>.fix・warn.<ID> もそろっていること
//   2. §4.1 の能力の表 ↔ CAPABILITY_IDS（src/data/schema.ts）
//   3. §7 の達成条件の表 ↔ 達成条件の種類（src/data/schema.ts の goalSchema）
// 今ある食い違いは scripts/spec-baseline.json に記録する。記録にない食い違いだけを誤りにする（記録は減る一方にする）。
// 使い方: node scripts/check-spec.mjs [--update]   --update は、今の食い違いで記録を書き直す（食い違いを減らしたコミットでだけ使う）
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const BASELINE = join(ROOT, 'scripts/spec-baseline.json');
const update = process.argv.includes('--update');

const specPath = join(ROOT, 'memo/NET.md');
if (!existsSync(specPath)) {
  console.log('check:spec: memo/NET.md がないため、突き合わせを省略する');
  process.exit(0);
}
const spec = readFileSync(specPath, 'utf8');

// 見出し（## 6. など）から次の同じ階層の見出しまでの本文
const section = (heading) => {
  const start = spec.indexOf(heading);
  if (start < 0) throw new Error(`NET.md に見出しがない: ${heading}`);
  const rest = spec.slice(start + heading.length);
  const next = rest.search(/\n## /);
  return next < 0 ? rest : rest.slice(0, next);
};
const rows = (text) => text.split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l)).map((l) => l.split('|').slice(1, -1).map((c) => c.trim()));
const ticks = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// --- 仕様 ---
const failuresSpec = new Set();
const warningsSpec = new Set();
for (const r of rows(section('## 6. 失敗と警告'))) {
  const id = ticks(r[1] ?? '')[0];
  if (!id) continue;
  if (r[2] === '失敗') failuresSpec.add(id);
  else if (r[2] === '警告') warningsSpec.add(id);
}
const capsSpec = new Set();
for (const r of rows(section('### 4.1 機器ごとの能力').split('\n## ')[0])) {
  // 機器の表（機器・口の既定・能力・役割の4列）は3列目、能力の説明の表（能力・説明の2列）は1列目
  for (const id of ticks(r.length >= 4 ? r[2] : r[0])) if (/^[a-zA-Z0-9]+$/.test(id)) capsSpec.add(id);
}
const goalsSpec = new Set();
for (const r of rows(section('## 7. 新しい達成条件'))) {
  const id = ticks(r[0] ?? '')[0];
  if (id) goalsSpec.add(id);
}

// --- コード ---
const failuresCode = new Set([...read('src/network/types.ts').match(/FAILURE_REASONS = \[([\s\S]*?)\] as const/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
const warningsCode = new Set([...read('src/network/query/warnings.ts').match(/export type VlanWarning = \{ id: ([^;]+);/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
const capsCode = new Set([...read('src/data/schema.ts').match(/CAPABILITY_IDS = \[([\s\S]*?)\] as const/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
const goalBlock = read('src/data/schema.ts').match(/export const goalSchema = z\.discriminatedUnion\('type', \[([\s\S]*?)\n\]\);/)[1];
const goalsCode = new Set([...goalBlock.matchAll(/type: z\.literal\('([^']+)'\)/g)].map((m) => m[1]));

const lang = JSON.parse(read('src/assets/lang/ja_jp.json'));

// 食い違い（"分類:ID" の形）
const found = [];
const diff = (name, a, b, aName, bName) => {
  for (const id of a) if (!b.has(id)) found.push(`${name}:${aName}だけ:${id}`);
  for (const id of b) if (!a.has(id)) found.push(`${name}:${bName}だけ:${id}`);
};
diff('失敗', failuresSpec, failuresCode, '仕様', 'コード');
diff('警告', warningsSpec, warningsCode, '仕様', 'コード');
diff('能力', capsSpec, capsCode, '仕様', 'コード');
diff('達成条件', goalsSpec, goalsCode, '仕様', 'コード');
for (const id of failuresCode) {
  if (!(`error.${id}` in lang)) found.push(`言語:error.${id}がない`);
  if (!(`error.${id}.fix` in lang)) found.push(`言語:error.${id}.fixがない`);
}
for (const id of warningsCode) if (!(`warn.${id}` in lang)) found.push(`言語:warn.${id}がない`);
found.sort();

if (update) {
  writeFileSync(BASELINE, `${JSON.stringify(found, null, 2)}\n`);
  console.log(`check:spec: 記録を書き直した（${found.length} 件）`);
  process.exit(0);
}

const baseline = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, 'utf8')) : [];
const fresh = found.filter((x) => !baseline.includes(x));
const fixed = baseline.filter((x) => !found.includes(x));
if (fixed.length > 0) console.log(`check:spec: 解消した食い違いが記録に残っている。node scripts/check-spec.mjs --update で消す（${fixed.length} 件）`);
if (fresh.length > 0) {
  console.error('check:spec: 仕様とコードの新しい食い違い:');
  for (const x of fresh) console.error(`  ${x}`);
  process.exit(1);
}
console.log(`check:spec: 新しい食い違いなし（記録 ${baseline.length} 件）`);
