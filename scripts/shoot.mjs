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
  g.getState().setSpeed(4);
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
    // 部屋の広さを選ぶ画面、社名を入れる画面の順に、どちらも「始める」を押す
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
  // 依頼の一覧
  offers: async (page) => {
    await scenes.career(page);
    await page.getByRole('button', { name: '依頼' }).first().click();
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
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'DEBUG' }).click();
    await page.waitForTimeout(500);
  },
  // デバッグの案内（N54）: パネルで、案件の手順 3 から始めた状態
  guidestart: async (page) => {
    await page.goto(`${URL_BASE}?debug=1`);
    await page.waitForFunction(() => window.__game !== undefined, null, { timeout: 30000 });
    await page.getByText('新しくプレイ').click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'DEBUG' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('combobox', { name: '手順' }).click();
    await page.getByRole('option', { name: '3', exact: true }).click();
    await page.getByRole('button', { name: 'この手順から始める' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: '閉じる' }).click();
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
