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
  // オフラインで開けるか
  await page.context().setOffline(true);
  await page.reload();
  await page.waitForTimeout(2000);
  console.log('オフラインのタイトル:', await page.title());
  await browser.close();
} finally {
  stop();
}
