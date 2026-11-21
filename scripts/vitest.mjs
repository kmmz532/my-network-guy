// Windows で作業ディレクトリのドライブ文字が小文字（f:）だと、vitest の本体と試験のファイルが別のパスで読まれ、
// 全試験が「No test suite found」で失敗する。ドライブ文字を大文字に直した作業ディレクトリで vitest を起動する。
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const cwd = process.cwd().replace(/^[a-z]:/, (d) => d.toUpperCase());
const bin = createRequire(`${cwd}/package.json`).resolve('vitest/vitest.mjs');
const r = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], { cwd, stdio: 'inherit' });
process.exit(r.status ?? 1);
