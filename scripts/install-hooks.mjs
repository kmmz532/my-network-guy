#!/usr/bin/env node
// コミットの前の hook（.git/hooks/pre-commit）を書き込む。npm install の prepare から呼ぶ。
// hook は `npm run verify:hook`（変更に関わる試験だけを動かす検査）を実行し、落ちればコミットを止める。--no-verify は使わない。
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const gitDir = join(ROOT, '.git');
// git の作業ツリーでない場所（配布物の展開先など）では何もしない
if (!existsSync(gitDir)) process.exit(0);
const hooks = join(gitDir, 'hooks');
mkdirSync(hooks, { recursive: true });
const file = join(hooks, 'pre-commit');
writeFileSync(file, '#!/bin/sh\nnpm run verify:hook\n');
try {
  chmodSync(file, 0o755);
} catch {
  // Windows では実行の権限を持たない（Git for Windows の sh が読む）
}
console.log('pre-commit の hook を書き込んだ');
