#!/usr/bin/env node
// コミットの前の hook（.git/hooks/pre-commit）を書き込む。npm install の prepare から呼ぶ。
// hook は scripts/pre-commit.mjs（ステージしたファイルの eslint と JSON の検査）を実行し、落ちればコミットを止める。--no-verify は使わない。
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const gitDir = join(ROOT, '.git');
// git の作業ツリーでない場所（配布物の展開先など）では何もしない
if (!existsSync(gitDir)) process.exit(0);
const hooks = join(gitDir, 'hooks');
mkdirSync(hooks, { recursive: true });
const file = join(hooks, 'pre-commit');
writeFileSync(file, '#!/bin/sh\nnode scripts/pre-commit.mjs\n');
try {
  chmodSync(file, 0o755);
} catch {
  // Windows では実行の権限を持たない（Git for Windows の sh が読む）
}
console.log('pre-commit の hook を書き込んだ');
