import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { DEBUG_ENABLED } from './debug';
import { usePhone } from './ui/usePhone';
import { balance, furniture } from 'virtual:game-data';
import type { FurnitureId } from './generated/ids';
import { seatCount } from './sim/furniture';
import { loadLang, t } from './i18n/t';
import { PixiStage } from './game/PixiStage';
import { useGameStore, type Speed } from './stores/useGameStore';
import { useTickLoop } from './stores/useTickLoop';
import { toDate } from './sim/clock';
import { loadSlot, saveSlot } from './services/db';
import { SAVE_SLOT, slotOf } from './services/slots';
import { createSaveQueue, isAutoSaveDue } from './services/autoSave';
import { exportSave, importSave } from './services/saveFile';
import { NoticeToast, ReportModal } from './components/Overlay';
import { dangerButton, Modal, primaryButton, secondaryButton } from './components/Modal';
import { KeyHelp } from './components/KeyHelp';
import { SettingsPanel } from './components/SettingsPanel';
import { SandboxSizePanel } from './components/SandboxSizePanel';
import { useKeymap } from './input/useKeymap';
import { tipText } from './input/keymap';
import { applyUiScale, loadSettings } from './settings/settings';
import { Toolbar } from './components/Toolbar';
import { Guide } from './components/Guide';
import { TaskPanel } from './components/TaskPanel';
import { Windows } from './components/Windows';
import { PortMenu } from './components/PortMenu';
import { HiringPanel, type HiringTab } from './components/HiringPanel';
import { Tooltip, TooltipHost, hideTip } from './components/Tooltip';
import { PausedBuildPrompt } from './components/PausedBuildPrompt';
import { LoopBanner } from './components/LoopBanner';
import { TabConflict } from './components/TabConflict';
import { UpdateNotice } from './components/UpdateNotice';
import { Icon } from './components/Icon';
import { TitleScreen } from './components/TitleScreen';
import { mapLoaders } from 'virtual:loaders';
import { RADIUS } from './ui/theme';
import { levelOf, nextLevel } from './sim/level';

const SPEEDS: Speed[] = [0, 1, 2, 4];
// 速さを変えたときに画面上部に出す表示は、この時間で消す
const SPEED_NOTE_MS = 1000;
// 自動保存の印（ヘッダーの小さなアイコン）は、この時間で消す
const SAVE_MARK_MS = 1000;

type Screen = 'title' | 'game';
type Popup = 'menu' | 'help' | 'settings' | 'sandboxResize' | 'sandboxReset' | 'sandboxResetConfirm' | null;

// 上部の操作（速さ・メニュー・社員）の大きさ。指で押すため、スマホでも 44 px の高さを確保する（M4）
const hudButton = (on: boolean) =>
  ({
    padding: '2px 8px',
    minHeight: 44,
    minWidth: 44,
    cursor: 'pointer',
    background: on ? '#ffd866' : '#25406f',
    color: on ? '#3b2a33' : '#f4f1e6',
    border: '1px solid #3b2a33',
    borderRadius: RADIUS.chrome,
  }) as const;

// デバッグのパネルは ?debug=1 のときだけ読み込む（N54）
const DebugPanel = lazy(() => import('./components/DebugPanel'));

export function App() {
  const [ready, setReady] = useState(false);
  // 翻訳や地図の読み込みが失敗したときの例外（エラー画面で再読み込みを促す。B9）
  const [loadError, setLoadError] = useState<unknown>(null);
  const [screen, setScreen] = useState<Screen>('title');
  const [popup, setPopup] = useState<Popup>(null);
  const [message, setMessage] = useState('');
  // タイトルから新しく始めるサンドボックスの広さを選ぶ画面
  const [sandboxPick, setSandboxPick] = useState(false);
  const clock = useGameStore((s) => s.clock);
  const companyExp = useGameStore((s) => s.companyExp);
  const levelNow = levelOf(companyExp, balance);
  const nextNow = nextLevel(companyExp, balance);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);
  // 勤務時間外に自動で早送りしている間の、元の速さ（「夜は早送り」と出す）
  const nightSpeed = useGameStore((s) => s.nightSpeed);
  const pausedPrompt = useGameStore((s) => s.pausedPrompt);
  // 速さを変えたときの短い表示（1秒で消す）
  const [speedNote, setSpeedNote] = useState<{ speed: Speed; id: number } | null>(null);
  const lastSpeed = useRef(speed);
  // 自動保存の印を出している間だけ値を持つ（自動保存が終わった時刻）
  const [saveMark, setSaveMark] = useState<number | null>(null);
  // 自動保存の直列化。実行中に次の要求が来たら、終わってから1回だけ書く（書く内容は実行時点の状態）
  const [autoSaver] = useState(() =>
    createSaveQueue(async () => {
      // 倒産した後の状態は保存しない（倒産の前の保存を残し、読み込みで倒産の前からやり直せるようにする）
      if (useGameStore.getState().clock.bankrupt) return;
      try {
        const data = useGameStore.getState().snapshot();
        // 遊び方ごとの枠に保存する（サンドボックスの自動保存で案件の枠を壊さない）
        await saveSlot(slotOf(data.mode), data);
        setSaveMark(Date.now());
      } catch {
        // 保存できなかったときは印を出さない
      }
    }),
  );
  const load = useGameStore((s) => s.load);
  const snapshot = useGameStore((s) => s.snapshot);
  const newGame = useGameStore((s) => s.newGame);
  const newSandbox = useGameStore((s) => s.newSandbox);
  const resizeSandbox = useGameStore((s) => s.resizeSandbox);
  // サンドボックスの画面。速度のボタン・社員・依頼は出さない
  const sandbox = useGameStore((s) => s.mode) === 'sandbox';
  const office = useGameStore((s) => s.office);
  // 社員の人数と席の数（席は自社オフィスの机の家具）。雇えなかった理由をHUDに出す
  const staff = useGameStore((s) => s.staff.length);
  const seats = useGameStore((s) => seatCount(s.office, (id) => furniture[id as FurnitureId]?.seat === true));
  const [hiring, setHiring] = useState(false);
  const [hiringTab, setHiringTab] = useState<HiringTab>('hiring');
  const openWindow = useGameStore((s) => s.openWindow);
  const cacheMap = useGameStore((s) => s.cacheMap);
  // 倉庫の欄の開け閉め（ツールバーと W キーで使う）
  const [warehouseOpen, setWarehouseOpen] = useState(false);
  // ヘッダーの下端（画面の座標）。狭い画面では案件の札と速さの表示を、ヘッダーの下に置く
  const headerRef = useRef<HTMLElement>(null);
  const [hudBottom, setHudBottom] = useState(0);
  const phone = usePhone();
  useLayoutEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const measure = () => setHudBottom(el.getBoundingClientRect().bottom);
    measure();
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    ro?.observe(el);
    window.addEventListener('resize', measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [ready, screen]);

  useTickLoop();
  useEffect(() => {
    if (lastSpeed.current === speed) return;
    lastSpeed.current = speed;
    const id = Date.now();
    setSpeedNote({ speed, id });
    const timer = window.setTimeout(() => setSpeedNote((n) => (n?.id === id ? null : n)), SPEED_NOTE_MS);
    return () => window.clearTimeout(timer);
  }, [speed]);
  // キーの表は、ゲームの画面が開いている間だけ効く。M・S・? はポップアップを、W は倉庫の欄を開け閉めする
  useKeymap(screen === 'game', {
    // 依頼とショップは、マップの操作を止めないウィンドウで開く（N40）
    togglePopup: (name) => {
      if (name === 'offers' || name === 'shop') useGameStore.getState().toggleWindow(name, '');
      else setPopup((p) => (p === name ? null : name));
    },
    toggleWarehouse: () => setWarehouseOpen((v) => !v),
  });

  useEffect(() => {
    // タイトル画面の間は時間を止める。端末の UI の大きさを反映する
    setSpeed(0);
    applyUiScale(loadSettings().uiScale);
    // 翻訳と、すべての地図を起動時に読み込んでから始める。依頼の判定は地図の読み込みに依存するため、読み込み中に判定させない
    const maps = Object.values(mapLoaders).map((load) => load().then((m) => cacheMap(m.default)));
    Promise.all([loadLang('ja_jp'), ...maps]).then(() => setReady(true), (e: unknown) => setLoadError(e ?? new Error('読み込みに失敗')));
  }, []);

  useEffect(() => {
    if (!saveMark) return;
    const timer = window.setTimeout(() => setSaveMark(null), SAVE_MARK_MS);
    return () => window.clearTimeout(timer);
  }, [saveMark]);

  // 設定が「しない」のときは保存しない。保存の判定は、その時点の設定で行う
  const autoSaveNow = () => {
    if (loadSettings().autoSave !== 'off') void autoSaver();
  };

  // 設定の間隔で、ゲーム内の朝0時を越えたら保存する（時間が戻った読み込みでは保存しない）
  const lastMinute = useRef(clock.minute);
  useEffect(() => {
    const prev = lastMinute.current;
    lastMinute.current = clock.minute;
    if (screen === 'game' && isAutoSaveDue(loadSettings().autoSave, prev, clock.minute)) autoSaveNow();
  }, [clock.minute]);

  // 案件を納品したとき（検収に通った報告が届いたとき）に保存する
  const lastReport = useGameStore((s) => s.lastReport);
  useEffect(() => {
    if (screen === 'game' && lastReport?.passed) autoSaveNow();
  }, [lastReport]);

  // ページを隠すとき・閉じるときに保存する
  useEffect(() => {
    if (screen !== 'game') return;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') autoSaveNow();
    };
    const onPageHide = () => autoSaveNow();
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
    };
  }, [screen]);

  if (loadError) throw loadError;
  if (!ready) return null;

  const startGame = () => {
    setMessage('');
    // 時間を進める初期の速さは設定で決める
    setSpeed(loadSettings().startSpeed);
    setScreen('game');
  };

  const onNew = () => {
    newGame();
    startGame();
  };

  const onContinue = async () => {
    const data = await loadSlot(SAVE_SLOT.career);
    if (!data) return setMessage(t('ui.title.none'));
    load(data);
    startGame();
  };

  // サンドボックスは、その枠に保存があれば続きから、なければ広さを選んで新しく始める
  const onSandbox = async () => {
    const data = await loadSlot(SAVE_SLOT.sandbox);
    if (data) {
      load(data);
      startGame();
    } else {
      setSandboxPick(true);
    }
  };

  if (screen === 'title')
    return (
      <>
        {sandboxPick && (
          <SandboxSizePanel
            title={t('ui.sandbox.size.title')}
            start={t('ui.sandbox.size.start')}
            onClose={() => setSandboxPick(false)}
            submit={(size) => {
              newSandbox(size);
              startGame();
              return null;
            }}
          />
        )}
        <TitleScreen onNew={onNew} onContinue={onContinue} onSandbox={onSandbox} message={message} />
      </>
    );

  const date = toDate(clock.minute, balance);

  const onSave = async () => {
    // 倒産した後は保存しない（倒産の前の保存を上書きしない）
    if (useGameStore.getState().clock.bankrupt) return;
    const data = snapshot();
    await saveSlot(slotOf(data.mode), data);
    setMessage(t('ui.save.done'));
  };

  const onExport = () => {
    // 倒産した後の状態は書き出さない
    if (useGameStore.getState().clock.bankrupt) return;
    const blob = new Blob([exportSave(snapshot())], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-network-guy-save.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = async (file: File) => {
    try {
      load(importSave(await file.text()));
      setMessage(t('ui.import.done'));
    } catch (e) {
      setMessage(t('ui.import.failed', { reason: (e as Error).message }));
    }
  };

  // メニューの項目。ボタンとファイルを選ぶラベルで、文字の大きさと見た目をそろえる
  const menuButton = { ...secondaryButton, display: 'block', width: '100%', margin: '4px 0', padding: '6px 12px', fontSize: 13, lineHeight: 1.4, boxSizing: 'border-box' } as const;

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%', overflow: 'hidden' }}>
      <TabConflict />
      <PixiStage warehouseOpen={warehouseOpen} />
      <header
        ref={headerRef}
        data-hud
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '6px 12px',
          background: 'rgba(47, 79, 143, 0.75)',
          color: '#f4f1e6',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 14,
          zoom: 'var(--ui-scale, 1)',
        }}
      >
        <span>
          <Icon name="icon/money" scale={1.5} style={{ verticalAlign: 'middle', marginTop: '-4px' }} /> {sandbox ? '∞' : clock.money.toLocaleString('ja-JP')}
        </span>
        {!sandbox && (
        <span>
          {/* 会社のレベルと、次のレベルまでの経験値（N45） */}
          <Icon name="icon/star" scale={1.5} style={{ verticalAlign: 'middle', marginTop: '-4px' }} />{' '}
          {t('ui.hud.level', { level: levelNow })}
          {nextNow ? ` ${t('ui.hud.nextLevel', { need: nextNow.need })}` : ` ${t('ui.hud.maxLevel')}`}
        </span>
        )}
        {!sandbox && (
        <span>
          <Icon name="icon/calendar" scale={1.5} style={{ verticalAlign: 'middle', marginTop: '-4px' }} /> {t('ui.hud.date', { year: date.year, month: date.month, day: date.day, hour: date.hour })}
        </span>
        )}
        {!sandbox && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* 押すと、社員の一覧を開く */}
          <button onClick={() => openWindow('staffList', '')} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
            {t('ui.staff.label', { staff, seats })}
          </button>
        </span>
        )}
        {!sandbox && (
        <span style={{ display: 'flex', gap: 4 }}>
          {SPEEDS.map((s) => (
            <Tooltip text={s === 0 ? tipText('ui.speed.0', 'pause', !phone) : t(`ui.speed.${s}` as const)} key={s}><button aria-label={t(`ui.speed.${s}` as const)} style={hudButton(speed === s)}  onClick={() => { hideTip(); setSpeed(s); }}>
              {s === 0 ? (
                <Icon name="icon/pause" scale={1} />
              ) : (
                Array.from({ length: s === 4 ? 3 : s }, (_, i) => <Icon key={i} name="icon/play" scale={1} />)
              )}
            </button></Tooltip>
          ))}
          {nightSpeed !== null && <span style={{ fontSize: 12, alignSelf: 'center' }}>{t('ui.night.fast')}</span>}
        </span>
        )}
        {/* 自動保存の印。文字は出さず、ツールチップだけ */}
        {/* 印を出していないときも場所を空けておく（出し入れでメニューボタンが動かないように） */}
        <Tooltip text={t('ui.autosave.mark')} style={{ marginLeft: 'auto' }}>
          <span
            role={saveMark !== null ? 'status' : undefined}
            aria-label={saveMark !== null ? t('ui.autosave.mark') : undefined}
            aria-hidden={saveMark === null}
            style={{ display: 'inline-flex', visibility: saveMark !== null ? 'visible' : 'hidden' }}
          >
            <Icon name="icon/save" scale={1} />
          </span>
        </Tooltip>
        <button style={hudButton(false)} onClick={() => setPopup('menu')}>
          <Icon name="icon/menu" scale={1} />
        </button>
      </header>
      {/* 狭い画面では、札をヘッダーの下に置く（ヘッダーの高さは zoom を掛けた画面の座標なので、札の上端は倍率で割って渡す） */}
      <TaskPanel top={phone ? (hudBottom + 6) / (loadSettings().uiScale) : 44} />
      <Windows
        onTraining={() => {
          setHiringTab('staff');
          setHiring(true);
        }}
      />
      <PortMenu />
      <Toolbar
        onOffers={() => useGameStore.getState().toggleWindow('offers', '')}
        onShop={() => useGameStore.getState().toggleWindow('shop', '')}
        hiringOpen={hiring}
        onHire={() => {
          setHiringTab('hiring');
          setHiring(!hiring);
        }}
        warehouseOpen={warehouseOpen}
        setWarehouseOpen={setWarehouseOpen}
      />
      <Guide />
      {DEBUG_ENABLED && (
        <Suspense fallback={null}>
          <DebugPanel />
        </Suspense>
      )}
      {hiring && <HiringPanel tab={hiringTab} onTab={setHiringTab} onClose={() => setHiring(false)} />}
      <TooltipHost />
      {popup === 'menu' && (
        <Modal onClose={() => setPopup(null)} boxStyle={{ minWidth: 200 }}>
          <button style={menuButton} onClick={onSave}>{t('ui.save')}</button>
          <button style={menuButton} onClick={onExport}>{t('ui.export')}</button>
          <label style={{ ...menuButton, textAlign: 'center' }}>
            {t('ui.import')}
            <input
              type="file"
              accept="application/json"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
            />
          </label>
          <button style={menuButton} onClick={() => setPopup('settings')}>
            {t('ui.menu.settings')}
          </button>
          <button
            style={menuButton}
            onClick={() => {
              setPopup(null);
              setSpeed(0);
              setScreen('title');
            }}
          >
            {t('ui.title.back')}
          </button>
          {sandbox && (
            <>
              <button style={menuButton} onClick={() => setPopup('sandboxResize')}>
                {t('ui.sandbox.size.change')}
              </button>
              <button style={menuButton} onClick={() => setPopup('sandboxResetConfirm')}>
                {t('ui.sandbox.size.reset')}
              </button>
            </>
          )}
          {message && <div style={{ marginTop: 6, fontSize: 13 }}>{message}</div>}
        </Modal>
      )}
      {popup === 'sandboxResize' && (
        <SandboxSizePanel
          title={t('ui.sandbox.size.change')}
          start={t('ui.sandbox.size.apply')}
          current={office.size}
          onClose={() => setPopup(null)}
          submit={(size) => {
            const reason = resizeSandbox(size);
            return reason === null ? null : t('ui.sandbox.size.blocked');
          }}
        />
      )}
      {popup === 'sandboxResetConfirm' && (
        // Enter で作り直しの広さを選ぶ画面へ進み、Esc で取り消す
        <Modal
          onClose={() => setPopup(null)}
          primary={() => setPopup('sandboxReset')}
          boxStyle={{ minWidth: 240 }}
        >
          <div style={{ fontWeight: 'bold', marginBottom: 12 }}>{t('ui.sandbox.size.resetConfirm')}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              style={{ padding: '4px 12px', cursor: 'pointer', background: 'transparent', color: '#f4f1e6', border: '1px solid #f4f1e6', borderRadius: RADIUS.none }}
              onClick={() => setPopup(null)}
            >
              {t('ui.sandbox.size.cancel')}
            </button>
            <button style={dangerButton} onClick={() => setPopup('sandboxReset')}>
              {t('ui.sandbox.size.recreate')}
            </button>
          </div>
        </Modal>
      )}
      {popup === 'sandboxReset' && (
        <SandboxSizePanel
          title={t('ui.sandbox.size.reset')}
          start={t('ui.sandbox.size.start')}
          onClose={() => setPopup(null)}
          submit={(size) => {
            newSandbox(size);
            return null;
          }}
        />
      )}
      {popup === 'help' && <KeyHelp onClose={() => setPopup(null)} />}
      {popup === 'settings' && <SettingsPanel onClose={() => setPopup(null)} onOpenKeys={() => setPopup('help')} />}
      <NoticeToast />
      {speedNote && (
        <div
          style={{
            position: 'absolute',
            top: phone ? (hudBottom + 6) / loadSettings().uiScale : 48,
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(47, 79, 143, 0.95)',
            color: '#ffd866',
            padding: '6px 14px',
            borderRadius: RADIUS.chrome,
            pointerEvents: 'none',
            zIndex: 9,
            zoom: 'var(--ui-scale, 1)',
          }}
        >
          {t(`ui.speed.${speedNote.speed}` as const)}
        </div>
      )}
      <LoopBanner />
      <UpdateNotice />
      {pausedPrompt && <PausedBuildPrompt />}
      <ReportModal />
      {clock.bankrupt && (
        <Modal
          primary={onNew}
          backStyle={{ background: 'rgba(20, 20, 30, 0.8)', flexDirection: 'column', gap: 12, color: '#f4f1e6' }}
          boxStyle={{ background: 'none', border: 'none', padding: 0, maxWidth: 'none', alignItems: 'center', display: 'flex', flexDirection: 'column', gap: 12 }}
        >
          <h2 style={{ fontSize: 28, margin: 0 }}>{t('ui.gameover.title')}</h2>
          <button style={{ ...primaryButton, padding: '10px 24px', fontSize: 16 }} onClick={onNew}>
            {t('ui.gameover.retry')}
          </button>
        </Modal>
      )}
    </div>
  );
}
