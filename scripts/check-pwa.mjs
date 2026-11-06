// PWA としてインストールできるかを確かめる。ビルド済みの dist-shoot を配信し、manifest・サービスワーカー・インストール条件を調べる。
// 先に: npx vite build --outDir dist-shoot --emptyOutDir
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5198;
const base = `http://localhost:${PORT}/my-network-guy/`;
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-shoot', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
const stop = () => (process.platform === 'win32' ? spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true }) : server.kill());
try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(base);
  await page.waitForTimeout(3000);
  const sw = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null);
  console.log('サービスワーカー:', sw);
  const client = await page.context().newCDPSession(page);
  const { installabilityErrors } = await client.send('Page.getInstallabilityErrors');
  console.log('インストールできない理由:', installabilityErrors.length ? JSON.stringify(installabilityErrors) : 'なし');
  const { url, errors } = await client.send('Page.getAppManifest');
  console.log('manifest:', url, errors.length ? errors : 'エラーなし');
  // オフラインで開けるか（N24）。インストール時に保存した資材で起動し、読み込めない資材がないことを確かめる
  // 登録が有効になるまで待つ（最大 20 秒）。有効にならなければ、オフラインの確認は失敗にする
  let active = null;
  for (let i = 0; i < 40 && !active; i++) {
    active = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? null);
    if (!active) await page.waitForTimeout(500);
  }
  if (!active) {
    console.log('サービスワーカーが有効にならなかった');
    process.exitCode = 1;
  }
  // 資材の保存が終わるまで待つ（保存の途中でオフラインにすると、読めなかった資材が出る）
  let saved = 0;
  for (let i = 0; i < 120; i++) {
    saved = await page.evaluate(async () => {
      const names = await caches.keys();
      let n = 0;
      for (const name of names) n += (await (await caches.open(name)).keys()).length;
      return n;
    });
    if (saved > 0 && (await page.evaluate(async () => (await navigator.serviceWorker.ready) && true))) {
      const total = await page.evaluate(async () => {
        const r = await fetch('./sw.js');
        const text = await r.text();
        return (text.match(/"\.\/assets\/[^"]+"/g) ?? []).length;
      });
      if (saved >= total + 4) break;
    }
    await page.waitForTimeout(500);
  }
  console.log('保存された資材の数:', saved);
  // 一度読み直して、サービスワーカーの管理下で読み込ませる。その後にオフラインで読み直す
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(2000);
  const missing = [];
  // 書体（Google Fonts）は保存の対象外（N24 の残り）。ここでは、ゲームの資材だけを確かめる
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(base)) missing.push(r.url());
  });
  await page.context().setOffline(true);
  await page.reload({ waitUntil: 'commit' }).catch(() => undefined);
  // タイトル画面の「新しくプレイ」が出ていれば、オフラインでも起動できている
  const started = await page.getByText('新しくプレイ').waitFor({ timeout: 20000 }).then(() => 1).catch(() => 0);
  console.log('オフラインのタイトル:', await page.title(), '／ タイトル画面:', started > 0 ? 'あり' : 'なし');
  console.log('オフラインで読めなかった資材:', missing.length ? JSON.stringify(missing) : 'なし');
  if (!started || missing.length) process.exitCode = 1;
  await browser.close();
} finally {
  stop();
}
