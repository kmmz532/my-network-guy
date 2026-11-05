// 画面の撮影ツール。開発サーバーを自動で起動し、指定した場面の画像を shots/ に保存する。
// 使い方: node scripts/shoot.mjs <場面> [<場面> ...]    例: node scripts/shoot.mjs title career
//         node scripts/shoot.mjs all                   すべての場面を撮る
//         オプション: --phone  スマホの縦持ち（390x844）で撮る   --out <ディレクトリ>  保存先（既定 shots）
// 実行のたびにビルドする（数十秒）。画像は shots/<場面>.png（--phone のときは shots/<場面>.phone.png）。画像は Read で開いて確かめる。
// 初回だけ、ブラウザを入れる: npx playwright install chromium
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = 5199;
const URL_BASE = `http://localhost:${PORT}/my-network-guy/`;
const args = process.argv.slice(2);
const phone = args.includes('--phone');
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : 'shots';
const names = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));

// 場面の一覧。page は開いたページ。game は開発中だけ window.__game（ゲームの状態）として使える
const scenes = {
  // タイトル画面
  title: async () => {},
  // 新しくプレイした直後（自社オフィス）
  career: async (page) => {
    await page.getByText('新しくプレイ').click();
    await page.waitForTimeout(1500);
  },
  // サンドボックス
  sandbox: async (page) => {
    await page.getByText('サンドボックス').click();
    await page.getByRole('button', { name: '始める' }).click();
    await page.waitForTimeout(1500);
  },
  // 依頼の一覧
  offers: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: '依頼' }).first().click();
    await page.waitForTimeout(500);
  },
  // ショップ
  shop: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: 'ショップ' }).first().click();
    await page.waitForTimeout(500);
  },
  // 倉庫を開いた状態
  warehouse: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: '倉庫' }).first().click();
    await page.waitForTimeout(500);
  },
  // 右上のメニュー
  menu: async (page) => {
    await scenes.career(page);
    await page.locator('header button').last().click();
    await page.waitForTimeout(500);
  },
};
scenes.all = null;

if (names.length === 0) {
  console.error('場面を指定してください: ' + Object.keys(scenes).join(' / '));
  process.exit(1);
}
const targets = names.includes('all') ? Object.keys(scenes).filter((n) => n !== 'all') : names;
for (const n of targets) {
  if (!scenes[n]) {
    console.error(`不明な場面: ${n}（${Object.keys(scenes).join(' / ')}）`);
    process.exit(1);
  }
}

// 開発サーバーは初回に依存の読み込みで失敗することがあるため、ビルドしてから配信する（dist-shoot は撮影専用で、コミットしない）
const DIST = 'dist-shoot';
await new Promise((resolve, reject) => {
  const build = spawn('npx', ['vite', 'build', '--outDir', DIST, '--emptyOutDir'], { shell: true, stdio: 'ignore' });
  build.on('exit', (code) => (code === 0 ? resolve() : reject(new Error('ビルドに失敗しました'))));
});
const server = spawn('npx', ['vite', 'preview', '--outDir', DIST, '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'pipe' });
const stop = () => {
  if (process.platform === 'win32') spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true });
  else server.kill();
};
process.on('exit', stop);

const waitServer = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await fetch(URL_BASE)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('開発サーバーが起動しませんでした');
};

try {
  await waitServer();
  await mkdir(outDir, { recursive: true });
  const browser = await chromium.launch();
  for (const name of targets) {
    // 場面ごとに新しいブラウザの状態（保存データなし）で始める
    const context = await browser.newContext(
      phone
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
        : { viewport: { width: 1280, height: 720 } },
    );
    const page = await context.newPage();
    page.on('pageerror', (e) => console.error(`[${name}] ページのエラー: ${e.message}`));
    await page.goto(URL_BASE);
    await page.waitForTimeout(1500);
    await scenes[name](page);
    const file = `${outDir}/${name}${phone ? '.phone' : ''}.png`;
    await page.screenshot({ path: file });
    console.log(`保存: ${file}`);
    await context.close();
  }
  await browser.close();
} finally {
  stop();
}
