// 候補つきの入力欄（ComboBox）の動作を、ブラウザで確かめる（N63 の組み直しの前後で同じ結果になることを見る）。
// 先に撮影用のビルド: VITE_SHOOT=1 npx vite build --outDir dist-shoot --emptyOutDir
// 使い方: node scripts/check-combo.mjs   （失敗があれば終了の符号を 1 にする）
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5197;
// IP の形が正しくないときの文言（ui.error.ip）
const FORMAT_ERROR = 'IPアドレスの形式が正しくない';
const base = `http://localhost:${PORT}/my-network-guy/`;
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-shoot', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
const stop = () => (process.platform === 'win32' ? spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true }) : server.kill());
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

// 機器の設定の「詳しく」→「ネットワーク」を開き、IP アドレスの欄（最初の combobox）を出す
async function openIpField(page) {
  await page.getByText('新しくプレイ').click();
  await page.waitForTimeout(1200);
  await page.evaluate(() => {
    const g = window.__game;
    g.getState().buy('pc_basic');
    for (let y = 1; y < 12; y++) for (let x = 1; x < 12; x++) {
      if (g.getState().place('pc_basic', x, y) === null) {
        const node = g.getState().office.nodes.find((n) => n.device === 'pc_basic' && n.x === x && n.y === y);
        g.getState().openWindow('device', node.uid);
        return;
      }
    }
  });
  await page.waitForTimeout(400);
  await page.getByText('設定', { exact: true }).click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: '詳しく', exact: true }).first().click();
  await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'ネットワーク', exact: true }).click();
  await page.waitForTimeout(400);
  return page.getByRole('combobox').first();
}

try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch();

  // パソコンの動作
  {
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 720 } })).newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
    const input = await openIpField(page);
    await input.click();
    await page.waitForTimeout(200);
    check('パソコン: 欄を押すと候補の一覧が開く', (await input.getAttribute('aria-expanded')) === 'true');
    check('パソコン: 欄は文字を打てる（inputMode が text）', (await input.getAttribute('inputmode')) !== 'none');
    const total = await page.getByRole('option').count();
    await input.fill('192.168.1.1');
    await page.waitForTimeout(150);
    const filtered = await page.getByRole('option').count();
    check('パソコン: 打った文字で候補を絞る', filtered > 0 && filtered <= total, `${filtered}/${total}`);
    const firstValue = await page.getByRole('option').first().textContent();
    await page.getByRole('option').first().click();
    await page.waitForTimeout(150);
    check('パソコン: 候補を押すと確定して閉じる', (await input.inputValue()).startsWith(firstValue.replace(/\s.*$/, '').trim()) && (await input.getAttribute('aria-expanded')) === 'false');
    await input.click();
    await input.fill('192.168.1.5');
    await input.press('Enter');
    await page.waitForTimeout(200);
    check('パソコン: Enter で打った値を確定する', (await input.inputValue()) === '192.168.1.5', await input.inputValue());
    await input.click();
    await input.fill('abc');
    await input.press('Enter');
    await page.waitForTimeout(150);
    const errorText = await page.getByText(FORMAT_ERROR, { exact: true }).count();
    check('パソコン: 形が正しくないと赤い文字で出し、元の値に戻す', errorText === 1 && (await input.inputValue()) === '192.168.1.5', await input.inputValue());
    await input.click();
    await input.fill('192.168.1.9');
    await input.press('Escape');
    await page.waitForTimeout(150);
    check('パソコン: Esc で入力前の値に戻す', (await input.inputValue()) === '192.168.1.5', await input.inputValue());
    await input.click();
    await input.fill('192.168.1.7');
    await page.mouse.click(5, 5);
    await page.waitForTimeout(200);
    check('パソコン: 欄を離れると確定する', (await input.inputValue()) === '192.168.1.7', await input.inputValue());
    await page.context().close();
  }

  // スマホの動作（縦持ち）
  {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    const page = await context.newPage();
    await page.goto(base);
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
    const input = await openIpField(page);
    await input.tap();
    await page.waitForTimeout(200);
    check('スマホ: 欄を押すと候補が開き、キーボードは開かない（inputMode none）', (await input.getAttribute('inputmode')) === 'none' && (await input.getAttribute('aria-expanded')) === 'true');
    const footer = page.getByText('キーボードで入力…');
    check('スマホ: 一覧の下端に「キーボードで入力…」がある', (await footer.count()) === 1);
    await footer.tap();
    await page.waitForTimeout(200);
    check('スマホ: 「キーボードで入力…」で入力モードに切り替わる（inputMode text）', (await input.getAttribute('inputmode')) !== 'none');
    await context.close();
  }

  await browser.close();
} finally {
  stop();
}
console.log(failures === 0 ? '結果: すべて OK' : `結果: ${failures} 件の NG`);
process.exitCode = failures === 0 ? 0 : 1;
