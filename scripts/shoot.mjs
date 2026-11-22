// 画面の撮影ツール。開発サーバーを自動で起動し、指定した場面の画像を shots/ に保存する。
// 使い方: node scripts/shoot.mjs <場面> [<場面> ...]    例: node scripts/shoot.mjs title career
//         node scripts/shoot.mjs all                   すべての場面を撮る
//         オプション: --phone  スマホの縦持ち（390x844）で撮る   --out <ディレクトリ>  保存先（既定 shots）
// 実行のたびにビルドする（数十秒）。画像は shots/<場面>.png（--phone のときは shots/<場面>.phone.png）。画像は Read で開いて確かめる。
// 初回だけ、ブラウザを入れる: npx playwright install chromium
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const PORT = 5199;
const URL_BASE = `http://localhost:${PORT}/my-network-guy/`;
const args = process.argv.slice(2);
const landscape = args.includes('--phone-landscape');
const phone = args.includes('--phone') || landscape;
const outIdx = args.indexOf('--out');
const outDir = outIdx >= 0 ? args[outIdx + 1] : 'shots';
const names = args.filter((a, i) => !a.startsWith('--') && (outIdx < 0 || i !== outIdx + 1));
// --check: ページのエラーや console のエラーが出たら、終了の符号を 1 にする（煙テストに使う）
const check = args.includes('--check');
let problems = 0;

// 施工までの流れ（テストの結果が出るまで時間を進め、施工を頼む）。untilResult なら施工の結果が出るまで進める。
// page.evaluate に渡すため、この関数の中だけで完結させる（外の変数を使わない）
const runBuild = (untilResult) => {
  const g = window.__game;
  // 4倍は会社のレベル3で解放されるため、Lv1 でも使える 1倍で進める
  g.getState().setSpeed(1);
  g.getState().test();
  for (let i = 0; i < 20000 && g.getState().active?.[0]?.testedOk !== true; i++) g.getState().tick();
  if (g.getState().active?.[0]?.testedOk !== true) throw new Error('テストが通らなかった');
  const err = g.getState().requestBuild();
  if (err) throw new Error('施工を頼めない: ' + err);
  if (untilResult) {
    for (let i = 0; i < 200000 && g.getState().lastReport === null; i++) g.getState().tick();
    if (g.getState().lastReport === null) throw new Error('結果が出なかった');
  }
};

// 場面の一覧。page は開いたページ。game は開発中だけ window.__game（ゲームの状態）として使える
// N51a の新しい地図の依頼を1件受注した状態（配置は確かめるための固定の位置）
const newMapScene = (offerId, map, title, pcs, goals) => async (page) => {
  await scenes.career(page);
  await page.evaluate(
    ({ offerId, map, title, pcs, goals }) => {
      const g = window.__game;
      const placed = pcs.map(([x, y], i) => ({ ref: `pc_${i + 1}`, device: 'pc_basic', x, y, locked: true }));
      const refs = placed.map((p) => p.ref);
      const offer = {
        id: offerId,
        kind: 'template',
        // 文言は元のひな形の ID を使う（_shoot を外す）
        baseId: offerId.replace(/_shoot$/, ''),
        params: { pcCount: placed.length },
        contract: {
          id: offerId,
          stage: 1,
          unlockLevel: 1,
          order: 0,
          deadlineDays: 14,
          requires: [],
          jobs: ['infra'],
          map,
          budget: 1000000,
          placed,
          goals: goals.map((x) => (x === '$all_pcs' ? { type: 'ping_all', nodes: refs } : x)),
          inhouse: false,
          reward: { money: 100000 },
        },
      };
      g.setState({ offers: [...g.getState().offers, offer] });
      const s = g.getState();
      const reason = s.accept(offerId, [s.staff[0].uid, s.staff[1].uid]);
      if (reason) throw new Error(`受注できない: ${reason}（${title}）`);
    },
    { offerId, map, title, pcs, goals },
  );
  await page.waitForTimeout(500);
};

// 役割付きの端末（ref と名前を指定）と、任意の目標を持つ依頼を1件受注した状態
const roleMapScene = (offerId, map, placed, goals) => async (page) => {
  await scenes.career(page);
  await page.evaluate(
    ({ offerId, map, placed, goals }) => {
      const g = window.__game;
      const offer = {
        id: offerId,
        kind: 'template',
        baseId: offerId.replace(/_shoot$/, ''),
        params: { pcCount: placed.length },
        contract: {
          id: offerId, stage: 1, unlockLevel: 1, order: 0, deadlineDays: 14, requires: [], jobs: ['infra'], map, budget: 1000000,
          placed: placed.map(([ref, name, x, y]) => ({ ref, name, device: 'pc_basic', x, y, locked: true })),
          goals, inhouse: false, reward: { money: 100000 },
        },
      };
      g.setState({ offers: [...g.getState().offers, offer] });
      const s = g.getState();
      const reason = s.accept(offerId, [s.staff[0].uid, s.staff[1].uid]);
      if (reason) throw new Error(`受注できない: ${reason}`);
    },
    { offerId, map, placed, goals },
  );
  await page.waitForTimeout(500);
};

// 会社の一覧の撮影用に、経営の会社を n 社ぶん作る（1社目を始め、その記録を写して枠を増やす）
const seedCompanies = async (page, n) => {
  await page.getByText('新しくプレイ').click();
  await page.waitForTimeout(800);
  const start = page.getByRole('button', { name: '始める' });
  if ((await start.count()) > 0) await start.first().click();
  await page.waitForTimeout(1500);
  await page.evaluate(async (n) => {
    const open = () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open('my-network-guy');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const db = await open();
    const all = await new Promise((resolve, reject) => {
      const req = db.transaction('saves').objectStore('saves').getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    const template = all[0];
    const tx = db.transaction('saves', 'readwrite');
    for (let i = 0; i < n; i++) {
      const data = { ...template.data, name: `試用社${i + 1}` };
      tx.objectStore('saves').put({ ...template, slot: 11 + i, savedAt: Date.now() - i * 60000, data });
    }
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }, n);
  await page.goto(URL_BASE);
  await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
  await page.waitForTimeout(1500);
};

// 道具の取り違えの一言の撮影用に、新しく始めた直後の案内を終えて、自社オフィスに機器を1台置き、その画面上の位置を返す（右クリックのメニューが出る位置を走査して探す）
const toolHintSetup = async (page) => {
  await scenes.career(page);
  await page.evaluate(() => {
    const g = window.__game;
    g.getState().markGuideDone('start');
    g.getState().buy('home_router');
    let placed = false;
    for (let y = 1; y < 12 && !placed; y++) for (let x = 1; x < 12 && !placed; x++) placed = g.getState().place('home_router', x, y) === null;
    if (!placed) throw new Error('機器を置けなかった');
  });
  await page.waitForTimeout(800);
  const box = await page.locator('canvas').first().boundingBox();
  const menu = page.locator('[data-context-menu]');
  for (let j = 0; j < 40; j++) {
    for (let i = 0; i < 60; i++) {
      const x = box.x + 20 + i * ((box.width - 40) / 60);
      const y = box.y + 80 + j * ((box.height - 160) / 40);
      await page.mouse.click(x, y, { button: 'right' });
      if ((await menu.count()) > 0) {
        await page.keyboard.press('Escape');
        await page.mouse.click(box.x + 5, box.y + box.height - 5);
        return { x, y };
      }
    }
  }
  throw new Error('機器の位置が見つからない');
};

const scenes = {
  // タイトル画面
  title: async () => {},
  // 新しくプレイした直後（自社オフィス）
  career: async (page) => {
    await page.getByText('新しくプレイ').click();
    await page.waitForTimeout(800);
    // 会社ごとのセーブ（N133）では、新しく始めるときに社名の入力が出る。既定の社名のまま始める（N160）
    const start = page.getByRole('button', { name: '始める' });
    if ((await start.count()) > 0) await start.first().click();
    await page.waitForTimeout(1500);
  },
  // 新しくプレイの社名の入力（始める前）
  namefield: async (page) => {
    await page.getByText('新しくプレイ').click();
    await page.waitForTimeout(800);
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
  // 会社の一覧（続けて遊ぶ）。会社を多く作り、一覧が5件まで出て残りは縦にスクロールすることを撮る
  companylist: async (page) => {
    await seedCompanies(page, 12);
    await page.getByText('コンティニュー').click();
    await page.waitForTimeout(800);
  },
  // 同じ一覧を最後まで送った状態（最後の会社が見えること）
  companylistend: async (page) => {
    await scenes.companylist(page);
    await page.getByText('試用社12').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  },
  // サンドボックスの始め方を選ぶ画面
  sandboxstart: async (page) => {
    await page.getByText('サンドボックス').click();
    await page.waitForTimeout(500);
  },
  // サンドボックスを教材から始める（社名を入れて、教材を開いた状態）
  sandboxlesson: async (page) => {
    await page.getByText('サンドボックス').click();
    await page.getByRole('button', { name: '教材から始める' }).click();
    await page.getByRole('button', { name: /OSPF/ }).first().click();
    await page.waitForTimeout(500);
    const start = page.getByRole('button', { name: '始める' });
    if ((await start.count()) > 0) await start.first().click();
    await page.waitForTimeout(1500);
  },
  // 配線の太さ（100M の古いケーブルと 1G の比較）
  cablespeed: async (page) => {
    await page.getByText('サンドボックス').click();
    await page.getByRole('button', { name: '教材から始める' }).click();
    await page.getByRole('button', { name: /近道と遠回り/ }).first().click();
    await page.waitForTimeout(500);
    const start = page.getByRole('button', { name: '始める' });
    if ((await start.count()) > 0) await start.first().click();
    await page.waitForTimeout(1500);
  },
  // サンドボックス
  sandbox: async (page) => {
    await page.getByText('サンドボックス').click();
    // 始め方は「自由に作る」。部屋の広さを選ぶ画面、社名を入れる画面の順に、どちらも「始める」を押す
    await page.getByRole('button', { name: '自由に作る' }).click();
    await page.getByRole('button', { name: '始める' }).click();
    await page.waitForTimeout(500);
    const start = page.getByRole('button', { name: '始める' });
    if ((await start.count()) > 0) await start.first().click();
    await page.waitForTimeout(1500);
  },
  // 教材を開き、閉じて、もう一度開く（ケーブルの色が初回と同じに付くかを撮影で確かめる）
  lessonreopen: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.openLesson('ospf_three_sites');
      g.test();
      window.__game.getState().openLesson('ospf_three_sites');
      window.__game.getState().test();
      window.__game.getState().closeLesson();
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => window.__game.getState().openLesson('ospf_three_sites'));
    await page.waitForTimeout(1000);
  },
  // 手順を進めてから同じ教材を開き直すと、案内が最初の手順から始まる
  guidereopen: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.openLesson('ospf_three_sites');
      g.openWindow('device', 'R1');
    });
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const g = window.__game.getState();
      for (const w of [...g.windows]) g.closeWindow(w.id);
      window.__game.getState().openLesson('ospf_three_sites');
    });
    await page.waitForTimeout(1000);
  },
  // 教材の案内の吹き出しに用語が出た場面（VRRP の教材で R1 を開き、手順 2 の文の後に VRRP の説明が出る）
  guideterm: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.openLesson('vrrp_pair');
      g.openWindow('device', 'R1');
    });
    await page.waitForTimeout(1000);
  },
  // 修理の依頼を学習モードで開き、テストする（左上の欄に依頼文と × の条件が出る）
  lessonrepair: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      window.__game.getState().openLesson('r002_wrong_gateway');
      window.__game.getState().test();
    });
    await page.waitForTimeout(1000);
  },
  // 演習を開く（左上の欄に問いの文と候補が出る）。drillhint は誤答1回（調べる場所の一言）、drillreveal は誤答2回（正解）、drillfix は正解の後の設定する問い
  drill: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => window.__game.getState().openLesson('static_route_basics'));
    await page.waitForTimeout(1000);
  },
  drillhint: async (page) => {
    await scenes.drill(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.answerInspect(g.drillView.choices.find((c) => c !== '10.0.23.2'));
    });
    await page.waitForTimeout(500);
  },
  drillreveal: async (page) => {
    await scenes.drillhint(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.answerInspect(g.drillView.choices.find((c) => c !== '10.0.23.2'));
    });
    await page.waitForTimeout(500);
  },
  drillfix: async (page) => {
    await scenes.drill(page);
    await page.evaluate(() => {
      window.__game.getState().answerInspect('10.0.23.2');
      window.__game.getState().test();
    });
    await page.waitForTimeout(1000);
  },
  drilldone: async (page) => {
    await scenes.drillfix(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      const reason = g.addRoute('R3', { dest: '10.0.1.0', prefix: 24, nextHop: '10.0.23.1' });
      if (reason) throw new Error('経路を足せない: ' + reason);
      window.__game.getState().test();
    });
    await page.waitForTimeout(800);
  },
  // 教材を達成した後に、発展の問いが左上の欄の下に出る
  followup: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.openLesson('stp_triangle');
      const reason = g.setStp('SW2', { op: 'priority', value: 4096 });
      if (reason) throw new Error('優先度を変えられない: ' + reason);
      window.__game.getState().test();
    });
    await page.waitForTimeout(1000);
  },
  // 教材の一覧に演習が並ぶ
  drillpicker: async (page) => {
    await scenes.sandbox(page);
    // 学習の記録を入れて、一覧の ✓ と正答率を出す
    await page.evaluate(() => {
      window.__game.setState({
        learn: {
          lessons: ['bgp_two_isps'],
          drills: { stp_root_drill: { done: true, questions: { q1: { right: 1, wrong: 1, first: false }, q2: { right: 1, wrong: 0, first: true } } } },
        },
      });
    });
    await page.locator('header button').last().click();
    await page.getByRole('button', { name: '教材を開く' }).click();
    await page.waitForTimeout(800);
  },
  // 機器を右クリックして、メニューを出す。機器の位置は決め打ちせず、画面を走査して、メニューが出た位置で止める
  contextmenu: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.getState().buy('pc_basic');
      let placed = false;
      for (let y = 2; y < 8 && !placed; y++) for (let x = 2; x < 10 && !placed; x++) placed = g.getState().place('pc_basic', x, y) === null;
      if (!placed) throw new Error('機器を置けなかった');
    });
    await page.waitForTimeout(500);
    const box = await page.locator('canvas').first().boundingBox();
    const menu = page.locator('[data-context-menu]');
    for (let j = 0; j < 40; j++) {
      for (let i = 0; i < 60; i++) {
        const x = box.x + 20 + i * ((box.width - 40) / 60);
        const y = box.y + 80 + j * ((box.height - 160) / 40);
        await page.mouse.click(x, y, { button: 'right' });
        if ((await menu.count()) > 0) {
          await page.waitForTimeout(300);
          return;
        }
      }
    }
    throw new Error('メニューが出なかった');
  },
  // 社員を右クリックして、「社員の情報を見る」の出たメニューを撮る。社員の位置は決め打ちせず、画面を走査して、そのメニューが出た位置で止める
  contextmenustaff: async (page) => {
    await scenes.day(page);
    const staffCount = await page.evaluate(() => window.__game.getState().staff.length);
    if (staffCount === 0) throw new Error('社員がいない');
    await page.waitForTimeout(500);
    const box = await page.locator('canvas').first().boundingBox();
    const menu = page.locator('[data-context-menu]');
    for (let j = 0; j < 40; j++) {
      for (let i = 0; i < 60; i++) {
        const x = box.x + 20 + i * ((box.width - 40) / 60);
        const y = box.y + 80 + j * ((box.height - 160) / 40);
        await page.mouse.click(x, y, { button: 'right' });
        if ((await menu.count()) > 0 && (await menu.innerText()).includes('社員の情報を見る')) {
          await page.waitForTimeout(300);
          return;
        }
      }
    }
    throw new Error('社員のメニューが出なかった');
  },
  // 4つの向き（上・下・左・右）の机を並べた自社オフィス。向きごとに、机のマスと椅子のマス（背中側）が空いている床を選んで机を置く
  deskfacings: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      const st = g.getState();
      g.setState({ owned: { ...st.owned, desk: (st.owned.desk ?? 0) + 4 } });
      const hq = st.maps.hq;
      const key = (x, y) => `${x},${y}`;
      const used = new Set([...st.office.furniture.map((f) => key(f.x, f.y)), ...st.office.nodes.map((n) => key(n.x, n.y))]);
      const isFloor = (x, y) => hq.legend[hq.tiles[y]?.[x]] === 'floor';
      // 向きと、その椅子のマスの位置（机からの差。up は手前、down は奥、left は右、right は左）
      const facings = [
        ['up', 0, 1],
        ['right', -1, 0],
        ['down', 0, -1],
        ['left', 1, 0],
      ];
      const spots = [];
      for (const [facing, dx, dy] of facings) {
        let spot = null;
        for (let y = 1; y < hq.height - 1 && !spot; y++) {
          for (let x = 1; x < hq.width - 1 && !spot; x++) {
            const chair = [x + dx, y + dy];
            if (isFloor(x, y) && isFloor(...chair) && !used.has(key(x, y)) && !used.has(key(...chair))) spot = [x, y, facing, chair];
          }
        }
        if (!spot) throw new Error(`机を置く場所がない（${facing}）`);
        used.add(key(spot[0], spot[1]));
        used.add(key(...spot[3]));
        spots.push(spot);
      }
      // 置いてから、向きを決める（撮影用に直接の向きを入れる。回す操作の確かめは試験で行う）
      for (const [x, y, facing] of spots) {
        if (g.getState().placeFurniture('desk', x, y) !== null) throw new Error('机を置けなかった');
        const uid = g.getState().office.furniture.find((f) => f.x === x && f.y === y).uid;
        g.setState({ office: { ...g.getState().office, furniture: g.getState().office.furniture.map((f) => (f.uid === uid ? { ...f, facing } : f)) } });
      }
    });
    await page.waitForTimeout(500);
  },
  // マップのポインタ操作（ホイール・中ボタンの移動・各道具での押す・ドラッグ・乗せる）を一通り行う。位置は決め打ちせず、画面全体を走査する。
  // 例外や console のエラーが出ないことを --check で確かめる
  pointer: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.getState().buy('l2_switch_8p');
      g.getState().buy('l2_switch_8p');
      let n = 0;
      for (let y = 2; y < 8 && n < 2; y++) for (let x = 2; x < 10 && n < 2; x++) if (g.getState().place('l2_switch_8p', x, y) === null) n++;
    });
    const box = await page.locator('canvas').first().boundingBox();
    // ヘッダーとツールバーのボタンを押さないよう、マップの中央寄りを走査する
    const at = (fx, fy) => [box.x + box.width * (0.25 + 0.5 * fx), box.y + box.height * (0.15 + 0.6 * fy)];
    const [cx, cy] = at(0.5, 0.5);
    await page.mouse.move(cx, cy);
    await page.mouse.wheel(0, -120);
    await page.mouse.wheel(0, 240);
    await page.mouse.wheel(0, -120);
    await page.mouse.down({ button: 'middle' });
    await page.mouse.move(cx + 40, cy + 20, { steps: 4 });
    await page.mouse.up({ button: 'middle' });
    for (const key of ['1', '2', '3', '1']) {
      await page.keyboard.press(key);
      for (let i = 1; i < 8; i++) {
        for (let j = 1; j < 6; j++) {
          const [x, y] = at(i / 8, j / 6);
          await page.mouse.move(x, y);
          await page.mouse.click(x, y);
        }
      }
      // ドラッグの途中で Esc を押して、取り消す
      const [x0, y0] = at(0.3, 0.4);
      await page.mouse.move(x0, y0);
      await page.mouse.down();
      await page.mouse.move(x0 + 80, y0 + 40, { steps: 6 });
      await page.keyboard.press('Escape');
      await page.mouse.up();
    }
    await page.waitForTimeout(500);
  },
  // キー入力の受け口。タイトルの矢印・Enter、ゲームの Space・数字キー・Esc が受け口を通って効くことを、状態で確かめる（外れたら例外）
  keys: async (page) => {
    const expect = (label, ok) => {
      if (!ok) throw new Error(`キー入力: ${label}`);
    };
    // タイトル: Enter で主のボタン（新しくプレイ）が押され、社名の入力が出る
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    expect('タイトルの Enter', (await page.getByRole('button', { name: '始める' }).count()) > 0);
    await page.getByRole('button', { name: '始める' }).first().click();
    await page.waitForTimeout(1500);
    const state = () => page.evaluate(() => ({ speed: window.__game.getState().speed, tool: window.__game.getState().tool, resume: window.__game.getState().resumeSpeed }));
    const first = await state();
    expect('ゲームの場面に入った', first.speed !== 0 || first.resume > 0);
    // Space: 一時停止と、止める前の速さへの復帰
    await page.evaluate(() => window.__game.getState().setSpeed(2));
    await page.keyboard.press('Space');
    expect('Space で停止', (await state()).speed === 0);
    await page.keyboard.press('Space');
    expect('Space で再開（2倍に戻る）', (await state()).speed === 2);
    // 数字キーで道具を切り替える
    await page.keyboard.press('2');
    expect('2 で配線の道具', (await state()).tool === 'wire');
    await page.keyboard.press('Escape');
    expect('Esc で選択の道具に戻る', (await state()).tool === 'select');
  },
  // キー操作の一覧（キー ?）
  keyhelp: async (page) => {
    await scenes.career(page);
    await page.keyboard.press('?');
    await page.waitForTimeout(500);
  },
  // 時間が止まっているときの施工の確認
  pausedbuild: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => window.__game.setState({ pausedPrompt: true }));
    await page.waitForTimeout(500);
  },
  // 依頼の一覧
  offers: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: '依頼' }).first().click();
    await page.waitForTimeout(500);
  },
  // 依頼の一覧に、提案の依頼（「提案」の札・依頼主の文・1.2倍の報酬）が届いた場面。届いている依頼の1件目を元に、提案の印を付けた依頼を足す
  proposal: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      const s = g.getState();
      const src = s.offers[0];
      if (!src) throw new Error('元にする依頼がない');
      const offer = {
        ...src,
        id: `${src.id}_proposal`,
        proposal: true,
        topic: 'vlan_isolation',
        arrivedMinute: s.clock.minute + 1,
        contract: { ...src.contract, id: `${src.id}_proposal`, reward: { money: Math.round(src.contract.reward.money * 1.2) } },
      };
      g.setState({ offers: [...s.offers, offer] });
    });
    await page.getByRole('button', { name: '依頼' }).first().click();
    await page.waitForTimeout(500);
  },
  // 自社の情報の画面に、実績の一覧が出た場面
  achievements: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.setState({ achievements: ['dmz', 'vlan_isolation'] });
      g.getState().openWindow('company', '');
    });
    await page.waitForTimeout(500);
  },
  // 案件を受注して設計に入った直後（案内の吹き出しが出る。スマホでの位置と、インベントリとの重なりを確かめる）
  guide: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: '依頼' }).first().click();
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '受注' }).first().click();
    await page.waitForTimeout(800);
  },
  // 新しくプレイした直後（時間は止まり、依頼のボタンが光って「依頼が届いています。開いてみよう」が出る）
  startguide: async (page) => {
    await scenes.career(page);
    await page.waitForTimeout(500);
  },
  // 依頼の窓を開いた後（最初の依頼の「受注」が光って「『受注』を押そう」が出る）
  startguide2: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: '依頼' }).first().click();
    await page.waitForTimeout(800);
  },
  // 配線の道具のまま機器を押して口の一覧が出たとき（選択の道具のボタンが光り、「設定は『選択』で開こう」が出る）
  toolhint1: async (page) => {
    const pos = await toolHintSetup(page);
    await page.evaluate(() => window.__game.getState().setTool('wire'));
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(800);
  },
  // 選択の道具で機器をドラッグして動かしたとき（配線の道具のボタンが光り、「つなぐときは『配線』を選ぼう」が出る）
  toolhint2: async (page) => {
    const pos = await toolHintSetup(page);
    await page.mouse.move(pos.x, pos.y);
    await page.mouse.down();
    await page.mouse.move(pos.x + 40, pos.y + 10, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(800);
  },
  // 撤去の道具で機器を片付けたとき（元に戻すのボタンが光り、「間違えたら『元に戻す』」が出る）
  toolhint3: async (page) => {
    const pos = await toolHintSetup(page);
    await page.evaluate(() => window.__game.getState().setTool('remove'));
    await page.mouse.click(pos.x, pos.y);
    await page.waitForTimeout(800);
  },
  // 新しく始めた直後の案内を閉じた状態（依頼のボタンの上に、案内を戻す札が出る）
  startguidehidden: async (page) => {
    await scenes.startguide(page);
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.waitForTimeout(500);
  },
  // 案内を出してから「しまう」を押した状態（吹き出しと枠が消え、案件の欄の見出しの行に顔のボタンと「次: 〜」の札が残る）
  guidehidden: async (page) => {
    await scenes.guide(page);
    await page.getByRole('button', { name: '閉じる' }).click();
    await page.waitForTimeout(500);
  },
  // 案件の欄の「案内」の行を開いた状態（手順の一覧と、済み・今の手順の印、「最初から見る」）
  guidereview: async (page) => {
    await scenes.guide(page);
    await page.locator('[data-task-panel]').getByRole('button', { name: /案内$/ }).first().click();
    await page.waitForTimeout(500);
  },
  // ショップ
  shop: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: 'ショップ' }).first().click();
    await page.waitForTimeout(500);
  },
  // デバッグのパネル（?debug=1 のときだけ出る。N54）
  debug: async (page) => {
    await page.goto(`${URL_BASE}?debug=1`);
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
    await page.getByText('新しくプレイ').click();
    await page.waitForTimeout(800);
    // 社名の入力が出るため、既定の社名のまま始める
    await page.getByRole('button', { name: '始める' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'DEBUG' }).click();
    await page.waitForTimeout(500);
  },
  // デバッグの案内（N54）: パネルで、案件の手順 3 から始めた状態
  guidestart: async (page) => {
    await page.goto(`${URL_BASE}?debug=1`);
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
    await page.getByText('新しくプレイ').click();
    await page.waitForTimeout(800);
    // 社名の入力が出るため、既定の社名のまま始める
    await page.getByRole('button', { name: '始める' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'DEBUG' }).click();
    await page.waitForTimeout(300);
    // 案件の先頭は新しく始めた直後の案内（手順が2つ）のため、最初の案件の案内を選ぶ
    await page.getByRole('combobox', { name: '案件' }).click();
    await page.getByRole('option', { name: 'PC2台の直結' }).click();
    await page.getByRole('combobox', { name: '手順' }).click();
    await page.getByRole('option', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: 'この手順から始める' }).click();
    await page.waitForTimeout(300);
    // 案内の吹き出しにも「閉じる」があるため、デバッグのパネルの × を押す
    await page.locator('.ui-window__close').click();
    await page.waitForTimeout(800);
  },
  // 雇用の画面（N63）: 会社のレベル10で夜勤が選べる。候補を1人つけて、雇用の画面を開いた状態
  hire: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.getState().debugSetCompanyLevel(10);
      const base = g.getState().staff[0];
      g.setState({ candidates: [{ ...base, uid: 'c_shoot_0', name: 'staff.name.5', exp: 0, training: null }] });
    });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '雇用', exact: true }).first().click();
    await page.waitForTimeout(500);
  },
  // N51a: 学校のパソコン室（school_lab。1部屋の広い教室、10台を2列で置く）
  mapSchool: newMapScene('t_school_lab_shoot', 'school_lab', '学校のパソコン室', [[2, 3], [5, 3], [8, 3], [11, 3], [14, 3], [17, 3], [2, 7], [5, 7], [8, 7], [11, 7]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // N51a: 長い廊下でつながる2部屋（long_hall。左右の部屋に3台ずつ）
  mapHall: newMapScene('t_long_hall_shoot', 'long_hall', '長い廊下の2部屋', [[2, 2], [6, 2], [4, 6], [32, 2], [36, 2], [34, 6]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  mapTwoSites: newMapScene('t_two_sites_lan_shoot', 'office_two_sites', '2拠点の地図（道路をはさむ）', [[2, 3], [2, 7], [38, 3], [38, 7]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // N51a: 小さな工場の作業場（factory。柱の列の間に16台）
  mapFactory: newMapScene('t_factory_shoot', 'factory', '工場の作業場', [[2, 1], [5, 1], [9, 1], [12, 1], [17, 1], [20, 1], [25, 1], [28, 1], [2, 10], [5, 10], [9, 10], [12, 10], [17, 10], [20, 10], [25, 10], [28, 10]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（カフェの客席）
  mapCafe: newMapScene('t_cafe_shoot', 'cafe', 'カフェの客席', [[2, 5], [6, 5], [10, 5], [13, 6]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（診療所）
  mapClinic: newMapScene('t_clinic_shoot', 'clinic', '診療所', [[2, 2], [9, 2], [16, 2], [3, 6]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（図書館）
  mapLibrary: newMapScene('t_library_shoot', 'library', '図書館', [[1, 3], [7, 3], [13, 5], [20, 7]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（コワーキング）
  mapCoworking: newMapScene('t_coworking_shoot', 'coworking', 'コワーキング', [[3, 2], [15, 2], [20, 3], [3, 7]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（ホテルの客室）
  mapHotel: newMapScene('t_hotel_floor_shoot', 'hotel_floor', 'ホテルの客室', [[2, 2], [8, 2], [14, 2], [20, 2]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（物流倉庫）
  mapWarehouse: newMapScene('t_warehouse_shoot', 'warehouse', '物流倉庫', [[2, 1], [12, 4], [22, 7], [31, 10], [5, 10]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（銀行の支店）
  mapBank: newMapScene('t_bank_branch_shoot', 'bank_branch', '銀行の支店', [[2, 2], [5, 6], [13, 2], [18, 6]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（撮影スタジオ）
  mapStudio: newMapScene('t_studio_shoot', 'studio', '撮影スタジオ', [[3, 3], [8, 6], [17, 3], [24, 7]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（キャンパス）
  mapCampus: newMapScene('t_campus_shoot', 'campus', 'キャンパス', [[3, 2], [11, 3], [3, 14], [11, 15]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 追加したマップ（病棟）
  mapHospital: newMapScene('t_hospital_ward_shoot', 'hospital_ward', '病棟', [[2, 2], [28, 3], [3, 10], [30, 11]], [{ type: 'ping_all', nodes: '$all_pcs' }]),
  // 役割付きの依頼（isolated の目標）
  mapCafeGuest: roleMapScene('t_cafe_guest_shoot', 'cafe', [['staff_1', '店員のPC1', 3, 1], ['staff_2', '店員のPC2', 9, 2], ['guest_1', 'お客さんのPC1', 2, 5], ['guest_2', 'お客さんのPC2', 8, 6], ['guest_3', 'お客さんのPC3', 13, 5]], [
    { type: 'ping_all', nodes: ['staff_1', 'staff_2'] },
    { type: 'ping_all', nodes: ['guest_1', 'guest_2', 'guest_3'] },
    { type: 'isolated', from: ['guest_1', 'guest_2', 'guest_3'], to: ['staff_1', 'staff_2'] },
  ]),
  // インベントリを開いた状態
  inventory: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: 'インベントリ' }).first().click();
    await page.waitForTimeout(500);
  },
  // インベントリの品目をマップへドラッグして置く。ドラッグの途中の Esc は、置かずに取り消す（外れたら例外）
  drag: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => window.__game.getState().buy('l2_switch_8p'));
    await page.getByRole('button', { name: 'インベントリ' }).first().click();
    await page.waitForTimeout(500);
    const nodes = () => page.evaluate(() => window.__game.getState().office.nodes.length);
    const item = page.getByRole('button', { name: 'L2スイッチ（8ポート）' }).first();
    const from = await item.boundingBox();
    const sx = from.x + from.width / 2;
    const sy = from.y + from.height / 2;
    const canvas = await page.locator('canvas').first().boundingBox();
    const dx = canvas.x + canvas.width * 0.5;
    const dy = canvas.y + canvas.height * 0.4;
    // Esc で取り消す
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(dx, dy, { steps: 8 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(200);
    if ((await nodes()) !== 0) throw new Error('ドラッグ: Esc で取り消せず、置かれた');
    // 離して置く
    await page.mouse.move(sx, sy);
    await page.mouse.down();
    await page.mouse.move(dx, dy, { steps: 8 });
    await page.mouse.up();
    await page.waitForTimeout(300);
    if ((await nodes()) !== 1) throw new Error('ドラッグ: 離しても置かれなかった');
  },
  // インベントリに多くの品目を入れた状態（折り返しとスクロールの確認）
  inventoryFull: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      const ids = ['pc_basic', 'laptop', 'server_basic', 'gpu_server', 'l2_switch_4p', 'l2_switch_8p', 'l3_switch', 'router_basic', 'router_switch', 'firewall', 'desk', 'plant', 'bookshelf', 'cabinet', 'coffee', 'water', 'trash', 'sofa', 'boxes'];
      g.setState({ owned: Object.fromEntries(ids.map((id) => [id, 3])) });
    });
    await page.getByRole('button', { name: 'インベントリ' }).first().click();
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
  // 自社の情報の画面（社員・資金・外部への接続の要約と、各画面を開く入口）
  company: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => window.__game.getState().openWindow('company', ''));
    await page.waitForTimeout(500);
  },
  // 採用の画面の社員のタブ（資格の札・研修・受験できる資格）。1人目に資格を持たせ、level を上げて受験できる資格を出す
  stafftraining: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      const staff = g.getState().staff.map((m, i) => (i === 0 ? { ...m, job: 'network', level: 8, certs: ['net1'] } : m));
      g.setState({ staff });
      g.getState().openWindow('staff', staff[0].uid);
    });
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '研修/資格へ' }).first().click();
    await page.waitForTimeout(500);
  },
  // 社員の詳細（退職の操作を含む）。採用から間もない社員は、退職を伝えられない理由を出す
  staffdetail: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.getState().openWindow('staff', g.getState().staff[0].uid);
    });
    await page.waitForTimeout(500);
  },
  // 採用の候補に内勤（営業・人事・経理）とエンジニアを並べる（札と、雇うと増える効果を見る）
  hiringjobs: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      const base = g.getState().staff[0];
      const jobs = ['sales', 'hr', 'accounting', 'network'];
      g.setState({ candidates: jobs.map((job, i) => ({ ...base, uid: `c_shoot_${i}`, name: 'staff.name.5', job, level: 3, exp: 0, training: null })) });
    });
    // 雇用の画面は、ツールバーの「雇用」のボタンで開く
    await page.getByRole('button', { name: /雇用|採用/ }).first().click();
    await page.waitForTimeout(500);
  },
  // 内勤の社員の詳細（効果の行）。2人目を営業にして開く
  staffback: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      const uid = g.getState().staff[1].uid;
      g.setState({ staff: g.getState().staff.map((m) => (m.uid === uid ? { ...m, job: 'sales', level: 4 } : m)) });
      g.getState().openWindow('staff', uid);
    });
    await page.waitForTimeout(500);
  },
  // 机を回した向き（left）の絵を確かめる
  facing: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.setState({ office: { ...g.getState().office, furniture: g.getState().office.furniture.map((f) => ({ ...f, facing: 'left' })) } });
    });
    await page.waitForTimeout(500);
  },
  // 夜（22時）の地図。時刻による色（N75）の確認用
  night: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      const c = g.getState().clock;
      g.setState({ clock: { ...c, minute: Math.floor(c.minute / 1440) * 1440 + 22 * 60 } });
    });
    await page.waitForTimeout(500);
  },
  // 自社の情報の床の行（解禁のレベル5に届いてから出す）
  floor: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.setState({ companyExp: 3000 });
      g.getState().openWindow('company', '');
    });
    await page.waitForTimeout(500);
  },
  // 自社の情報の「次のレベル」の欄（Lv7。次の Lv8 で床のカーペットが解放され、絵の札で出る）
  unlocknext: async (page) => {
    await scenes.career(page);
    // 画面の「Lv n」を見て、Lv7 になる最小の経験値を二分探索で決める
    const levelAt = async (exp) => {
      await page.evaluate((e) => window.__game.setState({ companyExp: e }), exp);
      await page.waitForTimeout(50);
      return Number((await page.getByText(/^Lv \d+$/).first().textContent()).slice(3));
    };
    let lo = 0;
    let hi = 1e6;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await levelAt(mid)) >= 7) hi = mid;
      else lo = mid;
    }
    await levelAt(hi);
    await page.evaluate(() => window.__game.getState().openWindow('company', ''));
    await page.waitForTimeout(500);
  },
  // 別室のドア。上限まで広げてから、右・左・下に別室を足す（仕切りの壁の縦と横のドアを見る）
  doors: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.setState({ companyExp: 1e7, clock: { ...g.getState().clock, money: 1e9 } });
      for (const side of ['right', 'left', 'bottom']) {
        for (let i = 0; i < 20 && !g.getState().office.annexes.includes(side); i++) g.getState().expandOffice(side);
      }
      g.getState().changeFloor('right', 'carpet');
      g.getState().changeFloor('bottom', 'tile');
    });
    await page.waitForTimeout(500);
  },
  // お金（HUD）を押して、資金の画面を開く
  funds: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: /資金/ }).first().click();
    await page.waitForTimeout(500);
  },
  // 退職の月末の確認（時間を進め、退職の予定の社員が月末に一覧から消えて退職金が出ることを確かめる）。結果は標準出力に出す
  retireend: async (page) => {
    await scenes.career(page);
    page.on('console', (m) => {
      if (m.text().startsWith('RETIRE ')) console.log(m.text());
    });
    await page.evaluate(() => {
      const g = window.__game;
      // 採用から十分な月がたっていることにし、1人目に退職を伝える
      g.setState({ staff: g.getState().staff.map((m) => ({ ...m, hiredMonth: -10 })) });
      const uid = g.getState().staff[0].uid;
      const reason = g.getState().noticeRetire(uid);
      const before = { staff: g.getState().staff.length, money: g.getState().clock.money, reason };
      g.getState().setSpeed(4);
      for (let i = 0; i < 40000 && g.getState().clock.paidMonths < 1; i++) g.getState().tick();
      const after = { staff: g.getState().staff.length, money: g.getState().clock.money, paidMonths: g.getState().clock.paidMonths };
      console.log('RETIRE ' + JSON.stringify({ before, after }));
    });
    await page.waitForTimeout(300);
  },
  // 退職を伝えた後の社員の詳細（月末に退職する。取り消しの操作を出す）
  staffleaving: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      const uid = g.getState().staff[0].uid;
      g.setState({ staff: g.getState().staff.map((m) => (m.uid === uid ? { ...m, leaving: true } : m)) });
      g.getState().openWindow('staff', uid);
    });
    await page.waitForTimeout(500);
  },
  // スイッチの機器の画面（設定タブは出ない。背面だけ）。空いている場所に置いて開く
  switch: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'l2_switch_8p');
  },
  // 家庭用ルーターの機器の画面（背面）。WAN の口を LAN と分けて出す
  homerouter: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'home_router');
    await page.waitForTimeout(800);
  },
  // 配線の道具で家庭用ルーターを押した口の一覧。WAN を先頭にし、口の番号は命令と同じ 0 から
  portmenu: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.getState().buy('home_router');
      let uid = null;
      for (let y = 1; y < 12 && uid === null; y++) {
        for (let x = 1; x < 12 && uid === null; x++) {
          if (g.getState().place('home_router', x, y) === null) uid = g.getState().office.nodes.find((n) => n.device === 'home_router' && n.x === x && n.y === y).uid;
        }
      }
      if (uid === null) throw new Error('機器を置けなかった');
      g.getState().setTool('wire');
      g.getState().openPortMenu(uid, 300, 200);
    });
    await page.waitForTimeout(500);
  },
  // 配線の道具でケーブルの端を持ったまま、別の機器の上に来た状態（口の一覧が出ている）。先に1本、一覧の口（スイッチの口 3）の上で離して、その口に差さるのを確かめる
  portpick: async (page) => {
    await scenes.sandbox(page);
    const place = (device) =>
      page.evaluate((id) => {
        const g = window.__game;
        g.getState().buy(id);
        const before = g.getState().office.nodes.length;
        for (let y = 2; y < 8 && g.getState().office.nodes.length === before; y++) for (let x = 2; x < 10 && g.getState().office.nodes.length === before; x++) g.getState().place(id, x, y);
        if (g.getState().office.nodes.length === before) throw new Error('機器を置けなかった');
        return g.getState().office.nodes[g.getState().office.nodes.length - 1].uid;
      }, device);
    // 右クリックのメニューが出る位置を走査して、機器の画面上の位置を探す（skip の近くは除く）
    const box = await page.locator('canvas').first().boundingBox();
    const menu = page.locator('[data-context-menu]');
    const find = async (skips) => {
      for (let j = 0; j < 40; j++) {
        for (let i = 0; i < 60; i++) {
          const x = box.x + 20 + i * ((box.width - 40) / 60);
          const y = box.y + 80 + j * ((box.height - 160) / 40);
          if (skips.some((skip) => Math.hypot(x - skip.x, y - skip.y) < 70)) continue;
          await page.mouse.click(x, y, { button: 'right' });
          if ((await menu.count()) > 0) {
            await page.keyboard.press('Escape');
            await page.mouse.click(box.x + 5, box.y + box.height - 5);
            return { x, y };
          }
        }
      }
      throw new Error('機器の位置が見つからない');
    };
    const pc = await place('pc_basic');
    const posPc = await find([]);
    const sw = await place('l2_switch_8p');
    const posSw = await find([posPc]);
    await page.evaluate(() => window.__game.getState().setTool('wire'));
    const links = () => page.evaluate(() => window.__game.getState().office.links.map((l) => [l.a.node, l.a.port, l.b.node, l.b.port]));
    const drag = async (release) => {
      await page.mouse.move(posPc.x, posPc.y);
      await page.mouse.down();
      await page.mouse.move((posPc.x + posSw.x) / 2, (posPc.y + posSw.y) / 2, { steps: 4 });
      await page.mouse.move(posSw.x, posSw.y, { steps: 4 });
      await page.waitForSelector('[data-port-row]', { timeout: 3000 });
      if (release) {
        const row = await page.locator('[data-port-row="3"]').boundingBox();
        await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, { steps: 4 });
        await page.mouse.up();
        await page.waitForTimeout(300);
      }
    };
    await drag(true);
    const made = await links();
    if (made.length !== 1 || made[0][3] !== 3 || made[0][2] !== sw) throw new Error('一覧の口の上で離しても、その口に差さらなかった: ' + JSON.stringify(made));
    // もう1台の PC から、口 3 が埋まったスイッチへ持っていき、一覧が出たまま撮る
    const pc2 = await place('pc_basic');
    const posPc2 = await find([posPc, posSw]);
    await page.mouse.move(posPc2.x, posPc2.y);
    await page.mouse.down();
    await page.mouse.move((posPc2.x + posSw.x) / 2, (posPc2.y + posSw.y) / 2, { steps: 4 });
    await page.mouse.move(posSw.x, posSw.y, { steps: 4 });
    await page.waitForSelector('[data-port-row]', { timeout: 3000 });
    const row = await page.locator('[data-port-row="5"]').boundingBox();
    await page.mouse.move(row.x + row.width / 2, row.y + row.height / 2, { steps: 4 });
    await page.waitForTimeout(300);
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
  // 施工の途中（設計を終えて施工を始めた直後。進みのバーと施工中の社員）
  build: async (page) => {
    await scenes.pctest(page);
    await page.evaluate(runBuild, false);
    await page.waitForTimeout(500);
  },
  // 結果画面（施工を最後まで進めて、報告を出す。時間は tick で進める）
  result: async (page) => {
    await scenes.pctest(page);
    await page.evaluate(runBuild, true);
    // 結果の報告は、納品から少し遅れて出る（REPORT_DELAY_MS）
    await page.waitForTimeout(4000);
  },
  // L2 スイッチを置き、機器の画面を開いた直後（設定の欄のない機器で、既定の背面の中身が最初から出るか）
  l2open: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.buy('l2_switch_8p');
      const reason = window.__game.getState().place('l2_switch_8p', 6, 6);
      if (reason) throw new Error(`置けない: ${reason}`);
      const s = window.__game.getState();
      const node = s.office.nodes.find((n) => n.device === 'l2_switch_8p');
      s.openWindow('device', node.uid);
    });
    await page.waitForTimeout(1000);
  },
  // 修理の依頼（r002）を受けて、ルーターの既定のゲートウェイを直し、納品した結果画面（変更の数の行）
  repairresult: async (page) => {
    await scenes.career(page);
    const contract = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'resources/data/contracts/r002_wrong_gateway.json'), 'utf8'));
    await page.evaluate((contract) => {
      const g = window.__game;
      const offer = { id: contract.id, kind: 'fixed', baseId: contract.id, params: {}, contract, arrivedMinute: g.getState().clock.minute };
      g.setState({ offers: [...g.getState().offers, offer] });
      const s = g.getState();
      const reason = s.accept(offer.id, [s.staff[0].uid, s.staff[1].uid]);
      if (reason) throw new Error(`受注できない: ${reason}`);
      // 壊れた箇所（ルーターの 192.168.3.1）を、正しい 192.168.2.1 に直す
      const r = g.getState().active[0].nodes.find((n) => n.uid === 'router');
      const idx = r.interfaces.findIndex((i) => i.ip === '192.168.3.1');
      g.getState().setIface('router', idx, '192.168.2.1', r.interfaces[idx].prefix);
      g.getState().test();
    }, contract);
    await page.waitForTimeout(350);
    await page.evaluate(runBuild, true);
    await page.waitForTimeout(4000);
  },
  // Lv8 に上がる結果画面（解放の多いレベル）。経験値を Lv7 の終わり近くにしてから納品する
  levelup8: async (page) => {
    await scenes.pctest(page);
    // HUD の「Lv 7」になる最大の経験値を探す（レベルの式を画面から読む）
    const lvAt = async (exp) => {
      await page.evaluate((e) => window.__game.setState({ companyExp: e }), exp);
      await page.waitForTimeout(30);
      return Number((await page.locator('text=/^Lv\\s*\\d+$/').first().textContent()).replace(/\D/g, ''));
    };
    let lo = 0;
    let hi = 1;
    while ((await lvAt(hi)) < 8) hi *= 2;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      if ((await lvAt(mid)) < 8) lo = mid;
      else hi = mid;
    }
    await lvAt(lo);
    await page.evaluate(runBuild, true);
    await page.waitForTimeout(4000);
  },
  // ケーブルを直線で描く設定。斜めの位置の2台のスイッチをつなぎ、直線で描いた状態
  straightcables: async (page) => {
    await scenes.career(page);
    await page.evaluate(() => {
      const g = window.__game;
      g.getState().buy('l2_switch_8p');
      g.getState().buy('l2_switch_8p');
      // 左上から1台、右下から1台を、空いている場所に置く
      const tryPlace = (xs, ys) => ys.some((y) => xs.some((x) => g.getState().place('l2_switch_8p', x, y) === null));
      const up = [...Array(12).keys()];
      const down = [...up].reverse();
      if (!tryPlace(up, up) || !tryPlace(down, down)) throw new Error('機器を置けなかった');
      const nodes = g.getState().office.nodes.filter((n) => n.device === 'l2_switch_8p');
      g.getState().connect(nodes[0].uid, nodes[1].uid, 'utp_cat5e');
      g.getState().setStraightCables(true);
    });
    await page.waitForTimeout(800);
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
  // IP の欄を押した状態（スマホではキーボードを開かず、候補と「キーボードで入力…」の行を出す。N62）
  ipfield: async (page) => {
    await scenes.select(page);
    await page.getByRole('combobox').first().click();
    await page.waitForTimeout(400);
  },
  // PC の設定で「詳しく」を開き、ネットワークの一覧を開いた状態（選択の部品）
  select: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'pc_basic');
    await page.getByText('設定', { exact: true }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '詳しく', exact: true }).first().click();
    await page.waitForTimeout(300);
    await page.getByRole('combobox', { name: 'ネットワーク', exact: true }).click();
    await page.waitForTimeout(500);
  },
  // 効果のある家具（観葉植物）を選んだ状態。効果の範囲（植物の周りの5×5マス）を、無線の範囲と同じ描き方で薄く塗る
  furniturerange: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.buy('plant');
      const reason = window.__game.getState().place('plant', 5, 5);
      if (reason !== null) throw new Error(`plant を置けない: ${reason}`);
      const plant = window.__game.getState().office.furniture.find((f) => f.id === 'plant');
      window.__ui.getState().setFurnitureRange(plant.uid);
    });
    await page.waitForTimeout(800);
  },
  // 電子レンジの近くの 2.4GHz のアクセスポイントにつながったノート PC の画面（設定タブの通信の品質の欄）
  wirelessquality: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      const put = (id, x, y) => {
        g.buy(id);
        const reason = window.__game.getState().place(id, x, y);
        if (reason !== null) throw new Error(`${id} を置けない: ${reason}`);
      };
      put('microwave', 2, 2);
      put('access_point', 4, 2);
      put('laptop', 6, 2);
      const st = window.__game.getState();
      const ap = st.office.nodes.find((n) => n.device === 'access_point');
      const cl = st.office.nodes.find((n) => n.device === 'laptop');
      for (const n of [ap, cl]) {
        for (const [key, value] of [['ssid', 'home'], ['password', 'pass1234']]) {
          const err = window.__game.getState().setWireless(n.uid, key, value);
          if (err) throw new Error(`${key}: ${err}`);
        }
      }
      const err = window.__game.getState().setWireless(ap.uid, 'band', '2.4');
      if (err) throw new Error(`band: ${err}`);
      window.__game.getState().openWindow('device', cl.uid);
    });
    await page.waitForTimeout(800);
    await page.getByText('設定', { exact: true }).click();
    await page.waitForTimeout(500);
  },
  // 5GHz・チャネル 52（DFS の説明）・方式 wpa2-eap（RADIUS のアドレスの欄）のアクセスポイントの設定の欄
  wirelessap: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.buy('access_point');
      const reason = window.__game.getState().place('access_point', 4, 2);
      if (reason !== null) throw new Error(`access_point を置けない: ${reason}`);
      const ap = window.__game.getState().office.nodes.find((n) => n.device === 'access_point');
      // 帯を先に変えてからチャネルを選ぶ（5GHz のチャネルは、帯を変えるまで選べない）
      for (const [key, value] of [['ssid', 'home'], ['band', '5'], ['channel', 52], ['security', 'wpa2_eap'], ['radius', '192.168.1.50']]) {
        const err = window.__game.getState().setWireless(ap.uid, key, value);
        if (err) throw new Error(`${key}: ${err}`);
      }
      window.__game.getState().openWindow('device', ap.uid);
    });
    await page.waitForTimeout(800);
    await page.getByText('設定', { exact: true }).click();
    await page.waitForTimeout(500);
    // 窓の下にある RADIUS の欄まで、設定の欄を送る
    await page.getByText('RADIUS サーバーのアドレス', { exact: true }).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  },
  // アクセスポイントの設定の欄の無線の部分（帯・チャネル・VLAN・方式）。VLAN は 10 にしてある
  wifisettings: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.buy('access_point');
      const reason = window.__game.getState().place('access_point', 4, 2);
      if (reason !== null) throw new Error(`access_point を置けない: ${reason}`);
      const ap = window.__game.getState().office.nodes.find((n) => n.device === 'access_point');
      for (const [key, value] of [['ssid', 'home'], ['vlan', 10]]) {
        const err = window.__game.getState().setWireless(ap.uid, key, value);
        if (err) throw new Error(`${key}: ${err}`);
      }
      window.__game.getState().openWindow('device', ap.uid);
    });
    await page.waitForTimeout(800);
    await page.getByText('設定', { exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByLabel('VLAN', { exact: true }).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  },
  // DHCP サーバーのプールに予約を1つ足した場面（予約の行と、追加の行が出ること）
  dhcpreserve: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game;
      for (const [id, x, y] of [['server_basic', 4, 2], ['pc_basic', 7, 2]]) {
        g.getState().buy(id);
        const reason = g.getState().place(id, x, y);
        if (reason !== null) throw new Error(`${id} を置けない: ${reason}`);
      }
      const srv = g.getState().office.nodes.find((n) => n.device === 'server_basic');
      for (const op of [
        { op: 'pool', pool: { network: '192.168.1.0', prefix: 24, start: '192.168.1.100', end: '192.168.1.199' } },
        { op: 'reserve', ip: '192.168.1.50', mac: '02:10:00:00:99:00' },
      ]) {
        const e = g.getState().setDhcp(srv.uid, op);
        if (e) throw new Error(`setDhcp: ${e}`);
      }
      g.getState().openWindow('device', srv.uid);
    });
    await page.waitForTimeout(800);
    await page.getByText('設定', { exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByText('予約する').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  },
  // アクセスポイントの MAC フィルターを有効にし、1つ登録した場面（無線の端末を登録するボタンが出ること）
  macfilter: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game;
      for (const [id, x, y] of [['access_point', 4, 2], ['laptop', 6, 3]]) {
        g.getState().buy(id);
        const reason = g.getState().place(id, x, y);
        if (reason !== null) throw new Error(`${id} を置けない: ${reason}`);
      }
      const ap = g.getState().office.nodes.find((n) => n.device === 'access_point');
      for (const op of [{ op: 'on' }, { op: 'add', mac: '02:10:00:00:99:00' }]) {
        const e = g.getState().setWirelessMacs(ap.uid, op);
        if (e) throw new Error(`setWirelessMacs: ${e}`);
      }
      g.getState().openWindow('device', ap.uid);
    });
    await page.waitForTimeout(800);
    await page.getByText('設定', { exact: true }).click();
    await page.waitForTimeout(500);
    await page.getByText('MAC フィルター（登録した端末だけをつなぐ）').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  },
  // スイッチの口にポートセキュリティを有効にし、MAC を1つ登録した場面（つながっている PC を登録するボタンが出ること）
  portsecurity: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game;
      for (const id of ['l2_switch_8p', 'pc_basic']) {
        g.getState().buy(id);
        let placed = false;
        for (let y = 2; y < 8 && !placed; y++) for (let x = 2; x < 10 && !placed; x++) placed = g.getState().place(id, x, y) === null;
        if (!placed) throw new Error(`${id} を置けない`);
      }
      const nodes = g.getState().office.nodes;
      const sw = nodes.find((n) => n.device === 'l2_switch_8p');
      const pc = nodes.find((n) => n.device === 'pc_basic');
      const err = g.getState().connect(sw.uid, pc.uid, 'utp_cat5e');
      if (err) throw new Error(`connect: ${err}`);
      const port = g.getState().office.links[0].a.node === sw.uid ? g.getState().office.links[0].a.port : g.getState().office.links[0].b.port;
      for (const op of [{ op: 'on' }, { op: 'add', mac: '02:10:00:00:99:00' }]) {
        const e = g.getState().setPortSecurity(sw.uid, port, op);
        if (e) throw new Error(`setPortSecurity: ${e}`);
      }
      g.getState().openWindow('device', sw.uid);
    });
    await page.waitForTimeout(800);
    await page.getByText('PC-1 LAN').first().click();
    await page.waitForTimeout(500);
    await page.getByText('ポートセキュリティ（登録した機器だけを通す）').first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
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
    // 始め方の選択（自由に作る）を含む共通の手順で始める。自前の手順では選択の画面で止まり、機器を置けなかった
    await scenes.sandbox(page);
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
  // 束ねた口（Po）の欄。チャネル1は口 0・1 を束ねて IP を入れ、チャネル2は口 2・3 を束ねて IP の欄を出した状態
  poline: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'router_basic');
    await page.evaluate(() => {
      const g = window.__game.getState();
      const n = g.office.nodes.find((x) => x.device === 'router_basic');
      for (const port of [0, 1]) g.setChannel(n.uid, { port, group: 1, lacp: 'active' });
      for (const port of [2, 3]) g.setChannel(n.uid, { port, group: 2, lacp: 'active' });
      g.setPo(n.uid, 1, '10.0.12.1', 30);
    });
    await page.getByText('設定', { exact: true }).click();
    await page.getByText('束ねたポートのインターフェース（Po）', { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  },
  // ファイアウォールの許可する通信の欄（通信の選択に DNS を出す）
  firewall: async (page) => {
    await scenes.sandbox(page);
    await openDevice(page, 'firewall');
    await page.getByText('設定', { exact: true }).click();
    await page.getByText('許可する通信', { exact: true }).scrollIntoViewIfNeeded();
    await page.getByLabel('通信', { exact: true }).first().click();
    await page.waitForTimeout(500);
  },
  // ファイアウォールの規則の追加の「通信」を開いた場面（一覧の下の方の選択肢が見えるかを撮る）
  fwrule: async (page) => {
    await scenes.sandbox(page);
    await openDevice(page, 'firewall');
    await page.getByText('設定', { exact: true }).click();
    await page.getByText('許可する通信', { exact: true }).scrollIntoViewIfNeeded();
    await page.getByLabel('通信', { exact: true }).last().click();
    await page.waitForTimeout(500);
  },
  // ロードバランサーの負荷分散の欄（仮想サーバーと、振り分け先の健全の印）
  // 負荷分散の欄の追加の入力（ラベル）。loadbalancer の場面の後に、追加のボタンまで送る
  loadbalanceradd: async (page) => {
    await scenes.loadbalancer(page);
    await page.getByRole('button', { name: '仮想サーバーを追加' }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
  },
  loadbalancer: async (page) => {
    await scenes.sandbox(page);
    await openDevice(page, 'load_balancer');
    await page.evaluate(() => {
      const g = window.__game.getState();
      const n = g.office.nodes.find((x) => x.device === 'load_balancer');
      g.setIface(n.uid, 0, '10.0.0.100', 24);
      g.setLoadBalancer(n.uid, [{ vip: '10.0.0.100', port: 80, members: [{ ip: '10.0.1.11', port: 80 }, { ip: '10.0.1.12', port: 80 }], method: 'round_robin', healthCheck: 'http', snat: true }]);
    });
    await page.getByText('設定', { exact: true }).click();
    // 振り分け先の追加の欄まで見せる（仮想サーバーの追加の欄は、画面の下の端）
    await page.getByText('負荷分散', { exact: true }).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  },
  // 機器の経路の欄（OSPF の3拠点の正解の構成のルーター。直結の C、静的の S、OSPF で覚えた O の行を出す）
  routetab: async (page) => {
    await page.getByText('サンドボックス').click();
    await page.getByRole('button', { name: '教材から始める' }).click();
    await page.getByRole('button', { name: /OSPF の3拠点/ }).first().click();
    await page.waitForTimeout(500);
    const start = page.getByRole('button', { name: '始める' });
    if ((await start.count()) > 0) await start.first().click();
    await page.waitForTimeout(1500);
    // 正解の構成（3台のルーターの全ポートで OSPF に参加）を入れ、R1 の画面を開く
    await page.evaluate(() => {
      const g = window.__game;
      const s = g.getState();
      const nodes = s.office.nodes.map((n) =>
        n.device === 'router_basic' ? { ...n, interfaces: n.interfaces.map((i) => ({ ...i, ospf: { area: 0 } })) } : n,
      );
      g.setState({ office: { ...s.office, nodes } });
      const r1 = nodes.find((n) => n.device === 'router_basic');
      g.getState().openWindow('device', r1.uid);
    });
    await page.waitForTimeout(800);
    await page.getByText('設定', { exact: true }).click();
    await page.getByText('経路', { exact: true }).first().scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  },
  // IPsec VPN の欄（トンネルの一覧と、張れているかの印）
  vpn: async (page) => {
    await scenes.sandbox(page);
    await openDevice(page, 'vpn_router');
    await page.evaluate(() => {
      const g = window.__game.getState();
      const n = g.office.nodes.find((x) => x.device === 'vpn_router');
      g.setIface(n.uid, 0, '203.0.113.2', 24);
      g.setVpn(n.uid, [{ peer: '198.51.100.2', psk: 'secret', cipher: 'aes', local: '10.1.0.0/24', remote: '10.2.0.0/24' }]);
    });
    await page.getByText('設定', { exact: true }).click();
    await page.getByText('VPN（IPsec）', { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  },
  // 回線終端（uplink）の設定。回線の欄（ISP の名前・アドレス・AS 番号・DNS）を出す
  isp: async (page) => {
    await scenes.sandbox(page);
    await openDevice(page, 'uplink');
    await page.getByText('設定', { exact: true }).click();
    await page.getByText('ISP の DNS', { exact: true }).scrollIntoViewIfNeeded();
    await page.waitForTimeout(500);
  },
  // サーバーを3台置き、動いているサービスで名前と役割の印が決まる（Web・DNS・Web+DNS の順。名前は Webサーバー-1、DNSサーバー-1、複合サーバー-1）
  servernames: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game;
      for (let i = 0; i < 3; i++) g.getState().buy('server_basic');
      [[2, 3], [5, 3], [8, 3]].forEach(([x, y]) => {
        if (g.getState().place('server_basic', x, y) !== null) throw new Error('機器を置けなかった');
      });
      const servers = g.getState().office.nodes.filter((n) => n.device === 'server_basic');
      // サーバーは置いたときに Web（http）が起動する。DNS だけの機器は Web を止める
      g.getState().setService(servers[1].uid, 'http', false);
      g.getState().setDnsRole(servers[1].uid, true, 'auth');
      g.getState().setDnsRole(servers[2].uid, true, 'auth');
    });
    await page.waitForTimeout(500);
  },
  // サーバーのサービスの欄（DNS の役割・ゾーンの記録を種類つきで出し、追加の欄を出す）
  dns: async (page) => {
    await scenes.career(page);
    await openDevice(page, 'server_basic');
    await page.evaluate(() => {
      const g = window.__game.getState();
      const n = g.office.nodes.find((x) => x.device === 'server_basic');
      g.setDnsRole(n.uid, true, 'auth');
      g.setDnsRecord(n.uid, { type: 'A', name: 'www', value: '192.168.1.10' });
      g.setDnsRecord(n.uid, { type: 'CNAME', name: 'web', value: 'www' });
      g.setDnsRecord(n.uid, { type: 'MX', name: 'example', value: 'mail', pref: 10 });
    });
    await page.getByText('サービス', { exact: true }).click();
    await page.waitForTimeout(500);
  },
  // ターミナル: 入力の予測（薄い文字）・誤りの語の下線・Tab の候補の一覧
  terminal: async (page) => {
    await scenes.sandbox(page);
    await openDevice(page, 'router_basic');
    await page.getByText('ターミナル', { exact: true }).click();
    const input = page.getByLabel('コマンドを入力');
    await input.fill('show ip');
    await input.press('?');
    await input.fill('conf');
    await input.press('Tab');
    await input.fill('show fo');
    await page.waitForTimeout(300);
  },
  // シーケンス図。ルーターを越える ping をターミナルで打ち、結果の欄の「シーケンス図を見る」から窓を開く
  sequence: async (page) => {
    await scenes.sandbox(page);
    await page.evaluate(() => {
      const g = window.__game.getState();
      g.buy('pc_basic');
      g.buy('pc_basic');
      g.buy('router_basic');
      g.place('pc_basic', 2, 2);
      g.place('pc_basic', 14, 2);
      g.place('router_basic', 8, 2);
      const st = () => window.__game.getState();
      const pcs = st().office.nodes.filter((n) => n.device === 'pc_basic');
      const r = st().office.nodes.find((n) => n.device === 'router_basic');
      st().connect(pcs[0].uid, r.uid, 'utp_cat5e');
      st().connect(pcs[1].uid, r.uid, 'utp_cat5e');
      st().setIface(pcs[0].uid, 0, '192.168.1.10', 24);
      st().setGateway(pcs[0].uid, '192.168.1.1');
      st().setIface(pcs[1].uid, 0, '192.168.2.10', 24);
      st().setGateway(pcs[1].uid, '192.168.2.1');
      st().setIface(r.uid, 0, '192.168.1.1', 24);
      st().setIface(r.uid, 1, '192.168.2.1', 24);
      st().openWindow('device', pcs[0].uid);
    });
    await page.waitForTimeout(800);
    await page.getByText('ターミナル', { exact: true }).click();
    const input = page.getByLabel('コマンドを入力');
    await input.fill('ping 192.168.2.10');
    await input.press('Enter');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: 'シーケンス図を見る' }).click();
    await page.waitForTimeout(500);
  },
  // シーケンス図の行を押した場面。ICMP エコー要求の行を押すと、パケットの中身の窓がその区間で開く
  sequencepick: async (page) => {
    await scenes.sequence(page);
    await page.locator('.ui-sequence__row', { hasText: 'ICMP エコー要求' }).first().locator('.ui-sequence__hit').click();
    await page.waitForTimeout(500);
  },
  // ターミナルの予測（薄い文字）。スマホでは次に打てる語のボタンと「→」のボタンも出る
  terminalghost: async (page) => {
    await scenes.sandbox(page);
    await openDevice(page, 'router_basic');
    await page.getByText('ターミナル', { exact: true }).click();
    await page.getByLabel('コマンドを入力').fill('conf');
    await page.waitForTimeout(300);
  },
  // ターミナルの Tab の候補の一覧
  terminaltab: async (page) => {
    await scenes.sandbox(page);
    await openDevice(page, 'router_basic');
    await page.getByText('ターミナル', { exact: true }).click();
    const input = page.getByLabel('コマンドを入力');
    await input.fill('show ip r');
    await input.press('Tab');
    await page.waitForTimeout(300);
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
    // インベントリに在庫がなければ、先に買う（撮影の場面では資金は十分にある）
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
        ? { viewport: landscape ? { width: 844, height: 390 } : { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true }
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
    // 場面の操作は window.__game（撮影用のビルドだけが持つ）を使う。読み込みが終わるまで待つ（B7）
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
    await page.waitForTimeout(1500);
    await scenes[name](page);
    // 表示中のボタン・入力欄の書体がゲームの書体でなければ誤りにする（親の書体を継がない部品を見つけるため）。
    // ターミナルの入力欄は実機に合わせて等幅の書体にしているため除く
    if (check) {
      const wrong = await page.evaluate(() =>
        [...document.querySelectorAll('button, input:not(.ui-terminal-input__field), select, textarea')]
          .filter((el) => el.getClientRects().length > 0 && !getComputedStyle(el).fontFamily.includes('DotGothic16'))
          .map((el) => `${el.tagName.toLowerCase()}「${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 20)}」(${getComputedStyle(el).fontFamily})`),
      );
      for (const w of wrong) {
        problems++;
        console.error(`[${name}] ゲームの書体でない部品: ${w}`);
      }
    }
    const file = `${outDir}/${name}${landscape ? '.phone-landscape' : phone ? '.phone' : ''}.png`;
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
