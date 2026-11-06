// バージョンを上げ、コミット・タグ作成・push までを行う。
// 使い方: npm run bump [-- patch|minor|major]（省略時は patch）
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const LEVELS = ['patch', 'minor', 'major']
const FILES = ['package.json', 'package-lock.json']

const level = process.argv[2] ?? 'patch'
if (!LEVELS.includes(level)) {
  throw new Error(`レベルは ${LEVELS.join('・')} のいずれかを指定してください: ${level}`)
}

const run = (cmd, args) =>
  execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'], shell: process.platform === 'win32' && cmd === 'npm' }).trim()

const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD'])
if (branch === 'HEAD') throw new Error('ブランチ上で実行してください（detached HEAD）')

// 他の変更は巻き込まない。対象の2ファイルだけが未コミットでないことを要求する。
if (run('git', ['status', '--porcelain', '--', ...FILES]) !== '') {
  throw new Error(`${FILES.join('・')} に未コミットの変更があります。先にコミットまたは破棄してください`)
}

run('npm', ['version', level, '--no-git-tag-version'])
const version = JSON.parse(readFileSync('package.json', 'utf8')).version
const tag = `v${version}`

run('git', ['add', '--', ...FILES])
run('git', ['commit', '-m', `chore: バージョンを ${version} にする`, '--', ...FILES])
run('git', ['tag', '-a', tag, '-m', tag])
run('git', ['push', 'origin', branch, tag])

console.log(`${tag} を作成し、${branch} とタグを push しました`)
