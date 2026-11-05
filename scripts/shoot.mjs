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
  // メニューの設定（画面の設定タブ）
  settings: async (page) => {
    await scenes.menu(page);
    await page.getByRole('button', { name: '設定' }).click();
    await page.waitForTimeout(500);
  },
  // 社員の一覧（キー H）
  staff: async (page) => {
    await scenes.career(page);
    await page.keyboard.press('h');
    await page.waitForTimeout(500);
  },
  // スイッチの機器の画面（設定タブは出ない。背面だけ）。空いている場所に置いて開く
  switch: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'l2_switch_8p');
  },
  // 2台のPCをつないだ直後（つながった瞬間の光は 450ms なので、操作の直後に撮る）
  connect: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      // PC は机の上にしか置けないので、置き場所に制限のないスイッチを2台つなぐ
      g.getState().buy('l2_switch_8p');
      g.getState().buy('l2_switch_8p');
      // 空いている場所を探して2台置く（place は成功なら null）
      let placed = 0;
      for (let y = 1; y < 12 && placed < 2; y++) {
        for (let x = 1; x < 12 && placed < 2; x++) {
          if (g.getState().place('l2_switch_8p', x, y) === null) placed++;
        }
      }
      const nodes = g.getState().office.nodes.filter((n) => n.device === 'l2_switch_8p');
      if (nodes.length < 2) throw new Error('機器を2台置けなかった');
      g.getState().connect(nodes[0].uid, nodes[1].uid, 'utp_cat5e');
    });
  },
  // PC の設定で「詳しく」を開き、ネットワークの一覧を開いた状態（選択の部品）
  select: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'pc_basic');
    await page.getByText('設定', { exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '詳しく', exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'ネットワーク', exact: true }).click();
    await page.waitForTimeout(500);
  },
  // ルーターの機器の画面（設定タブ・経路の追加を含む）
  router: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'router_basic');
    await page.getByText('設定', { exact: true }).click();
    await page.waitForTimeout(500);
  },
};

// 機器を空いている場所に置き、その機器の画面を開く（撮影用の window.__game を使う）
// place は、成功なら null、失敗なら理由のキー（例: stock）を返す
async function openDevice(page, deviceId) {
  await page.evaluate((id) => {
    // 倉庫に在庫がなければ、先に買う（撮影の場面では資金は十分にある）
    window.__game.getState().buy(id);
    for (let y = 1; y < 12; y++) {
      for (let x = 1; x < 12; x++) {
        if (window.__game.getState().place(id, x, y) === null) {
          const node = window.__game.getState().office.nodes.find((n) => n.device === id && n.x === x && n.y === y);
          window.__game.getState().openWindow('device', node.uid);
          return;
        }
      }
    }
    throw new Error('機器を置ける場所がない');
  }, deviceId);
  await page.waitForTimeout(800);
}
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
  // VITE_SHOOT で、画面の状態を操作するための window.__game を撮影用のビルドに入れる
  const build = spawn('npx', ['vite', 'build', '--outDir', DIST, '--emptyOutDir'], {
    shell: true,
    stdio: 'ignore',
    env: { ...process.env, VITE_SHOOT: '1' },
  });
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
