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
// --check: ページのエラーや console のエラーが出たら、終了の符号を 1 にする（煙テストに使う）
const check = args.includes('--check');
let problems = 0;

// 場面の一覧。page は開いたページ。game は開発中だけ window.__game（ゲームの状態）として使える
const scenes = {
  // タイトル画面
  title: async () => {},
  // 新しくプレイした直後（自社オフィス）
  career: async (page) => {
    await page.getByText('新しくプレイ').click();
    await page.waitForTimeout(1500);
  },
  // 昼（10時）の自社オフィス。社員は机に座っている
  day: async (page) => {
    await scenes.career(page);
    await setHour(page, 10);
    await page.waitForTimeout(500);
  },
  // 夜（22時）の自社オフィス。社員はドアから退勤し、机は空いている（歩いて出る途中も撮れる）
  night: async (page) => {
    await scenes.career(page);
    await setHour(page, 22);
    await page.waitForTimeout(6000);
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
  // 案件を受注して設計に入った直後（案内の吹き出しが出る。スマホでの位置と、倉庫との重なりを確かめる）
  guide: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: '依頼' }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '受注' }).first().click();
    await page.waitForTimeout(800);
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
  // 疎通テストの流れ（パケット）。2台をつないでテストを押し、流れの途中を撮る（時間は止めたまま）
  trace: async (page) => {
    await scenes.connect(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.getState().setSpeed(0);
      g.getState().test();
    });
    // 流れの途中で撮る（2台のあいだを粒が走る時間の半分ほど）
    await page.waitForTimeout(350);
  },
  // 設計中の案件で、PC どうしをつないでIPを付け、テストを押した直後（時間は設計で止まっている）
  pctest: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      const s = g.getState();
      const reason = s.accept('c001_direct_link', [s.staff[0].uid, s.staff[1].uid]);
      if (reason) throw new Error(`受注できない: ${reason}`);
      const st = g.getState();
      st.connect('pc_a', 'pc_b', 'utp_cat5e');
      st.setIface('pc_a', 0, '192.168.1.10', 24);
      st.setIface('pc_b', 0, '192.168.1.11', 24);
      g.getState().test();
    });
    await page.waitForTimeout(350);
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
  // つなぐのに失敗した直後（機器を自分につなぐ。失敗の吹き出しと、赤い輪・揺れを撮る）
  fail: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.getState().buy('l2_switch_8p');
      let placed = false;
      for (let y = 1; y < 12 && !placed; y++) {
        for (let x = 1; x < 12 && !placed; x++) {
          if (g.getState().place('l2_switch_8p', x, y) === null) placed = true;
        }
      }
      const node = g.getState().office.nodes.find((n) => n.device === 'l2_switch_8p');
      if (!node) throw new Error('機器を置けなかった');
      g.getState().connect(node.uid, node.uid, 'utp_cat5e');
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
  // スイッチ付きルーターに、WAN と LAN の IP を入れた場面（マップの IP の表示が重ならないかを確かめる）
  routerswitch: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'router_switch');
    await page.evaluate(() => {
      const g = window.__game.getState();
      const n = g.office.nodes.find((x) => x.device === 'router_switch');
      g.setIface(n.uid, 0, '192.168.1.1', 24);
      g.setIface(n.uid, 1, '192.168.2.1', 24);
    });
    await page.waitForTimeout(800);
  },
  // サンドボックスで、2台のPCを直結して IP を入れ、テストを押す（「すべての疎通が通った」を出す）
  sandboxok: async (page) => {
    await page.getByText('サンドボックス').click();
    await page.getByRole('button', { name: '始める' }).click();
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.buy('pc_basic');
      g.buy('pc_basic');
      for (const [x, y] of [[2, 2], [6, 2]]) g.place('pc_basic', x, y);
      const pcs = window.__game.getState().office.nodes.filter((n) => n.device === 'pc_basic');
      window.__game.getState().connect(pcs[0].uid, pcs[1].uid, 'utp_cat5e');
      window.__game.getState().setIface(pcs[0].uid, 0, '192.168.1.10', 24);
      window.__game.getState().setIface(pcs[1].uid, 0, '192.168.1.11', 24);
      window.__game.getState().test();
    });
    await page.waitForTimeout(1500);
  },
  // ルーターの機器の画面（設定タブ・経路の追加を含む）
  router: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'router_basic');
    await page.getByText('設定', { exact: true }).click();
    await page.waitForTimeout(500);
  },
};

// 時刻を、その日の指定の時（時）に合わせる（撮影用の window.__game を使う）
async function setHour(page, hour) {
  await page.evaluate((h) => {
    const g = window.__game;
    g.setState({ clock: { ...g.getState().clock, minute: Math.floor(g.getState().clock.minute / 1440) * 1440 + h * 60 } });
  }, hour);
}

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
    page.on('pageerror', (e) => {
      problems++;
      console.error(`[${name}] ページのエラー: ${e.message}`);
    });
    page.on('console', (msg) => {
      if (msg.type() !== 'error') return;
      problems++;
      console.error(`[${name}] コンソールのエラー: ${msg.text()}`);
    });
    await page.goto(URL_BASE);
    await page.waitForTimeout(1500);
    await scenes[name](page);
    const file = `${outDir}/${name}${phone ? '.phone' : ''}.png`;
    await page.screenshot({ path: file });
    console.log(`保存: ${file}`);
    await context.close();
  }
  await browser.close();
  if (check) {
    if (problems > 0) {
      console.error(`煙テスト: ${problems} 件のエラー`);
      process.exitCode = 1;
    } else console.log('煙テスト: エラーなし');
  }
} finally {
  stop();
}
