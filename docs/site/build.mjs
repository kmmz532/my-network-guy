// docs/ のサイトを生成する。Node で Markdown とゲームのデータを集め、PHP（php/render.php）でページにする。
// 使い方: npm run site [出力先]（既定は dist/docs。vite build の後に実行する）
import { readFileSync, readdirSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const docsDir = join(root, 'docs');
const out = resolve(root, process.argv[2] ?? 'dist/docs');
const lang = JSON.parse(readFileSync(join(root, 'resources/lang/ja_jp.json'), 'utf8'));

const t = (key) => {
  if (!(key in lang)) throw new Error(`文言がない: ${key}`);
  return lang[key];
};

// サイトに載せない文書。リンクは GitHub 上の Markdown へ向ける
const excluded = new Set(['deploy.md']);
const repoDocs = 'https://github.com/kmmz532/my-network-guy/blob/main/docs/';

const htmlName = (md) => (md === 'README.md' ? 'index.html' : md.replace(/\.md$/, '.html'));

// docs 内の .md へのリンクを .html へ向け直す
marked.use({
  walkTokens(token) {
    if (token.type === 'link' && /^[\w-]+\.md(#.*)?$/.test(token.href)) {
      token.href = token.href.replace(/^([\w-]+\.md)/, (name) => (excluded.has(name) ? repoDocs + name : htmlName(name)));
    }
  },
});

const docs = readdirSync(docsDir)
  .filter((f) => f.endsWith('.md') && !excluded.has(f))
  .map((file) => {
    const source = readFileSync(join(docsDir, file), 'utf8');
    const title = source.match(/^# (.+)$/m)?.[1];
    if (!title) throw new Error(`見出し（# ）がない: docs/${file}`);
    return { href: htmlName(file), title, html: marked.parse(source) };
  })
  .sort((a, b) => Number(b.href === 'index.html') - Number(a.href === 'index.html'));

const devicesDir = join(root, 'resources/data/devices');
const devices = readdirSync(devicesDir)
  .filter((f) => f.endsWith('.json'))
  .flatMap((f) => JSON.parse(readFileSync(join(devicesDir, f), 'utf8')).devices)
  .map((d) => ({
    id: d.id,
    name: t(`device.${d.id}.name`),
    desc: t(`device.${d.id}.desc`),
    category: t(`category.${d.category}`),
    price: d.price,
    unlockLevel: d.unlockLevel,
    ports: d.ports,
    capabilities: d.capabilities ?? [],
  }))
  .sort((a, b) => a.unlockLevel - b.unlockLevel || a.price - b.price);

const nav = [...docs.map(({ href, title }) => ({ href, title })), { href: 'devices.html', title: '機器の一覧' }];

const render = (page) =>
  execFileSync('php', [join(docsDir, 'site/php/render.php')], {
    input: JSON.stringify({ ...page, nav }),
    encoding: 'utf8',
  });

mkdirSync(out, { recursive: true });
for (const doc of docs) writeFileSync(join(out, doc.href), render({ kind: 'doc', ...doc }));
writeFileSync(join(out, 'devices.html'), render({ kind: 'devices', href: 'devices.html', devices }));
cpSync(join(docsDir, 'images'), join(out, 'images'), { recursive: true });
console.log(`${out}（${docs.length + 1}ページ）`);
