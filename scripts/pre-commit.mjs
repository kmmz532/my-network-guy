#!/usr/bin/env node
// コミットの前の検査。ステージしたファイルだけを見る（複数の担当が並行して作業し、ファイルを指定してコミットするため、
// 作業ツリー全体や他の担当の未完成の変更では止めない）。ステージした src/**/*.{ts,tsx} の eslint と、JSON の重複キーの検査を行う。
import { execFileSync, spawnSync } from 'node:child_process';

const staged = execFileSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACM'], { encoding: 'utf8' })
  .split('\n')
  .filter((f) => /^src\/.*\.(ts|tsx)$/.test(f));
const run = (cmd, args) => spawnSync(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32' }).status === 0;
let ok = true;
if (staged.length > 0) ok = run('npx', ['eslint', ...staged]) && ok;
ok = run('npm', ['run', '--silent', 'check:json']) && ok;
process.exit(ok ? 0 : 1);
