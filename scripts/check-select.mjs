// 選択ボックス（Select。N63）の動作を、ブラウザで確かめる。依頼の並べ替えで開閉・選択・Esc・↑↓・Enter・外を押すと閉じる、を見る。
// 先に撮影用のビルド: VITE_SHOOT=1 npx vite build --outDir dist-shoot --emptyOutDir
// 使い方: node scripts/check-select.mjs   （失敗があれば終了の符号を 1 にする）
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const PORT = 5196;
const base = `http://localhost:${PORT}/my-network-guy/`;
const server = spawn('npx', ['vite', 'preview', '--outDir', 'dist-shoot', '--port', String(PORT), '--strictPort'], { shell: true, stdio: 'ignore' });
const stop = () => (process.platform === 'win32' ? spawn('taskkill', ['/pid', String(server.pid), '/T', '/F'], { shell: true }) : server.kill());
let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'OK  ' : 'NG  '} ${name}${detail ? `  (${detail})` : ''}`);
  if (!ok) failures++;
};

try {
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch(base)).ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 500));
  }
  const browser = await chromium.launch();
  for (const phone of [false, true]) {
    const context = await browser.newContext(
      phone
        ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, hasTouch: true, isMobile: true }
        : { viewport: { width: 1280, height: 720 } },
    );
    const page = await context.newPage();
    const tag = phone ? 'スマホ' : 'パソコン';
    await page.goto(base);
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
    await page.getByText('新しくプレイ').click();
    await page.waitForTimeout(1200);
    await page.getByRole('button', { name: '依頼' }).first().click();
    await page.waitForTimeout(500);
    const box = page.getByRole('combobox', { name: '並べ方' });
    check(`${tag}: 並べ方の欄は選択ボックスの部品（role combobox）`, (await box.count()) === 1);
    check(`${tag}: 初めは「新しい順」`, (await box.textContent()).includes('新しい順'));
    await (phone ? box.tap() : box.click());
    await page.waitForTimeout(200);
    check(`${tag}: 押すと一覧が開く（aria-expanded）`, (await box.getAttribute('aria-expanded')) === 'true');
    const options = page.getByRole('option');
    check(`${tag}: 選択肢は3つ`, (await options.count()) === 3, `${await options.count()}`);
    if (phone) {
      const h = (await options.first().boundingBox())?.height ?? 0;
      check(`${tag}: 行の高さは 44 px 以上（指で押す）`, h >= 44, `${Math.round(h)} px`);
    }
    await (phone ? options.nth(2).tap() : options.nth(2).click());
    await page.waitForTimeout(200);
    check(`${tag}: 項目を押すと確定して閉じる`, (await box.textContent()).includes('報酬の高い順') && (await box.getAttribute('aria-expanded')) === 'false');
    await box.focus();
    await box.press('Enter');
    await page.waitForTimeout(150);
    check(`${tag}: Enter で一覧が開く`, (await box.getAttribute('aria-expanded')) === 'true');
    await box.press('ArrowDown');
    await box.press('Enter');
    await page.waitForTimeout(150);
    check(`${tag}: ↑↓で動かして Enter で確定（報酬の高い順の次は、最初に戻る）`, (await box.textContent()).includes('新しい順'), (await box.textContent()).trim());
    await box.press('Enter');
    await page.waitForTimeout(150);
    await box.press('Escape');
    await page.waitForTimeout(150);
    check(`${tag}: Esc で閉じて、選びは変えない`, (await box.getAttribute('aria-expanded')) === 'false' && (await box.textContent()).includes('新しい順'));
    await box.click();
    await page.waitForTimeout(150);
    // 一覧の外で、パネルの中の何もないところを押す（スマホは暗い所でパネルが閉じるため、パネルの中で確かめる）
    await page.getByRole('dialog').first().click({ position: { x: 8, y: 40 } });
    await page.waitForTimeout(200);
    check(`${tag}: 外を押すと閉じる`, (await page.getByRole('listbox').count()) === 0);
    await context.close();
  }
  await browser.close();
} finally {
  stop();
}
console.log(failures === 0 ? '結果: すべて OK' : `結果: ${failures} 件の NG`);
process.exitCode = failures === 0 ? 0 : 1;
