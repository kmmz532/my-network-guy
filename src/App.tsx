import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { usePhone } from './ui/usePhone';
import { balance, furniture } from 'virtual:game-data';
import type { FurnitureId } from './generated/ids';
import { seatCount } from './sim/furniture';
import { loadLang, t } from './i18n/t';
import { PixiStage } from './game/PixiStage';
import { focusedProject, useGameStore, type Speed } from './stores/useGameStore';
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
import { OfferCards } from './components/OfferCards';
import { Toolbar } from './components/Toolbar';
import { Guide } from './components/Guide';
import { TaskPanel } from './components/TaskPanel';
import { Windows } from './components/Windows';
import { PortMenu } from './components/PortMenu';
import { ShopCards } from './components/ShopCards';
import { HiringPanel, type HiringTab } from './components/HiringPanel';
import { Tooltip, TooltipHost, hideTip } from './components/Tooltip';
import { PausedBuildPrompt } from './components/PausedBuildPrompt';
import { LoopBanner } from './components/LoopBanner';
import { Icon } from './components/Icon';
import { TitleScreen } from './components/TitleScreen';
import { mapLoaders } from 'virtual:loaders';
import { RADIUS } from './ui/theme';

const SPEEDS: Speed[] = [0, 1, 2, 4];
// 速さを変えたときに画面上部に出す表示は、この時間で消す
const SPEED_NOTE_MS = 1000;
// 自動保存の印（ヘッダーの小さなアイコン）は、この時間で消す
const SAVE_MARK_MS = 1000;

type Screen = 'title' | 'game';
type Popup = 'offers' | 'shop' | 'menu' | 'help' | 'settings' | 'sandboxResize' | 'sandboxReset' | 'sandboxResetConfirm' | null;

const hudButton = (on: boolean) =>
  ({
    padding: '2px 8px',
    cursor: 'pointer',
    background: on ? '#ffd866' : '#25406f',
    color: on ? '#3b2a33' : '#f4f1e6',
    border: '1px solid #3b2a33',
    borderRadius: RADIUS.chrome,
  }) as const;

export function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('title');
  const [popup, setPopup] = useState<Popup>(null);
  const [message, setMessage] = useState('');
  // タイトルから新しく始めるサンドボックスの広さを選ぶ画面
  const [sandboxPick, setSandboxPick] = useState(false);
  const clock = useGameStore((s) => s.clock);
  const reputation = useGameStore((s) => s.reputation);
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
  const candidates = useGameStore((s) => s.candidates);
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
    togglePopup: (name) => setPopup((p) => (p === name ? null : name)),
    toggleWarehouse: () => setWarehouseOpen((v) => !v),
  });

  useEffect(() => {
    // タイトル画面の間は時間を止める。端末の UI の大きさを反映する
    setSpeed(0);
    applyUiScale(loadSettings().uiScale);
    loadLang('ja_jp').then(() => setReady(true));
    mapLoaders.office_small().then((m) => cacheMap(m.default));
  }, []);

  // 受注した案件のマップは、配置や描画のために読み込んでおく
  const activeMap = useGameStore((s) => focusedProject(s)?.contract.map);
  useEffect(() => {
    if (activeMap && !useGameStore.getState().maps[activeMap]) {
      mapLoaders[activeMap as keyof typeof mapLoaders]().then((m) => cacheMap(m.default));
    }
  }, [activeMap]);

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
    const data = snapshot();
    await saveSlot(slotOf(data.mode), data);
    setMessage(t('ui.save.done'));
  };

  const onExport = () => {
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
      <PixiStage />
      <header
        ref={headerRef}
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
        <span>
          <Icon name="icon/star" scale={1.5} style={{ verticalAlign: 'middle', marginTop: '-4px' }} /> {reputation}
        </span>
        <span>
          <Icon name="icon/calendar" scale={1.5} style={{ verticalAlign: 'middle', marginTop: '-4px' }} /> {t('ui.hud.date', { year: date.year, month: date.month, day: date.day, hour: date.hour })}
        </span>
        {!sandbox && (
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {/* 押すと、社員の一覧を開く */}
          <button onClick={() => openWindow('staffList', '')} style={{ background: 'none', border: 'none', padding: 0, color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
            {t('ui.staff.label', { staff, seats })}
          </button>
          {/* 候補が0人のときは押せない（半透明） */}
          <Tooltip text={t('ui.staff.hire')}><button aria-label={t('ui.staff.hire')} style={{ ...hudButton(hiring), opacity: candidates.length > 0 ? 1 : 0.4 }}

            disabled={candidates.length === 0}
            onClick={() => {
              setHiringTab('hiring');
              setHiring(!hiring);
            }}
          >
            <Icon name="icon/person" scale={1} />
          </button></Tooltip>
        </span>
        )}
        {!sandbox && (
        <span style={{ display: 'flex', gap: 4 }}>
          {SPEEDS.map((s) => (
            <Tooltip text={s === 0 ? tipText('ui.speed.0', 'pause') : t(`ui.speed.${s}` as const)} key={s}><button aria-label={t(`ui.speed.${s}` as const)} style={hudButton(speed === s)}  onClick={() => { hideTip(); setSpeed(s); }}>
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
        <Tooltip text={t('ui.autosave.mark')}>
          <span
            role={saveMark !== null ? 'status' : undefined}
            aria-label={saveMark !== null ? t('ui.autosave.mark') : undefined}
            aria-hidden={saveMark === null}
            style={{ display: 'inline-flex', marginLeft: 'auto', visibility: saveMark !== null ? 'visible' : 'hidden' }}
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
        onOffers={() => setPopup('offers')}
        onShop={() => setPopup('shop')}
        warehouseOpen={warehouseOpen}
        setWarehouseOpen={setWarehouseOpen}
      />
      <Guide />
      {popup === 'offers' && <OfferCards onClose={() => setPopup(null)} />}
      {popup === 'shop' && <ShopCards onClose={() => setPopup(null)} />}
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
