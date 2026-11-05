import { useEffect, useRef, useState } from 'react';
import { balance, furniture } from 'virtual:game-data';
import type { FurnitureId } from './generated/ids';
import { seatCount } from './sim/furniture';
import { loadLang, t } from './i18n/t';
import { PixiStage } from './game/PixiStage';
import { focusedProject, useGameStore, type Speed } from './stores/useGameStore';
import { useTickLoop } from './stores/useTickLoop';
import { toDate } from './sim/clock';
import { loadSlot, saveSlot } from './services/db';
import { exportSave, importSave } from './services/saveFile';
import { NoticeToast, ReportModal } from './components/Overlay';
import { Modal, primaryButton } from './components/Modal';
import { KeyHelp } from './components/KeyHelp';
import { SettingsPanel } from './components/SettingsPanel';
import { useKeymap } from './input/useKeymap';
import { tipText } from './input/keymap';
import { applyUiScale, loadSettings } from './settings/settings';
import { OfferCards } from './components/OfferCards';
import { Toolbar } from './components/Toolbar';
import { TaskPanel } from './components/TaskPanel';
import { Windows } from './components/Windows';
import { PortMenu } from './components/PortMenu';
import { ShopCards } from './components/ShopCards';
import { HiringPanel, type HiringTab } from './components/HiringPanel';
import { Tooltip, TooltipHost, hideTip } from './components/Tooltip';
import { PausedBuildPrompt } from './components/PausedBuildPrompt';
import { Icon } from './components/Icon';
import { TitleScreen } from './components/TitleScreen';
import { mapLoaders } from 'virtual:loaders';
import { RADIUS } from './ui/theme';

const SLOT = 1;
const SPEEDS: Speed[] = [0, 1, 2, 4];
// 速さを変えたときに画面上部に出す表示は、この時間で消す
const SPEED_NOTE_MS = 1000;

type Screen = 'title' | 'game';
type Popup = 'offers' | 'shop' | 'menu' | 'help' | 'settings' | null;

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
  const load = useGameStore((s) => s.load);
  const snapshot = useGameStore((s) => s.snapshot);
  const newGame = useGameStore((s) => s.newGame);
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
    mapLoaders.hq().then((m) => cacheMap(m.default));
  }, []);

  // 受注した案件のマップは、配置や描画のために読み込んでおく
  const activeMap = useGameStore((s) => focusedProject(s)?.contract.map);
  useEffect(() => {
    if (activeMap && !useGameStore.getState().maps[activeMap]) {
      mapLoaders[activeMap as keyof typeof mapLoaders]().then((m) => cacheMap(m.default));
    }
  }, [activeMap]);

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
    const data = await loadSlot(SLOT);
    if (!data) return setMessage(t('ui.title.none'));
    load(data);
    startGame();
  };

  if (screen === 'title') 
    return <TitleScreen onNew={onNew} onContinue={onContinue} message={message} />;

  const date = toDate(clock.minute, balance);

  const onSave = async () => {
    await saveSlot(SLOT, snapshot());
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
  const menuButton = { display: 'block', width: '100%', margin: '4px 0', padding: '6px 12px', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13, lineHeight: 1.4, boxSizing: 'border-box', border: '1px solid #767676', borderRadius: RADIUS.none, background: '#efefef', color: '#000' } as const;

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden' }}>
      <PixiStage />
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '6px 12px',
          background: 'rgba(47, 79, 143, 0.92)',
          color: '#f4f1e6',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 14,
          zoom: 'var(--ui-scale, 1)',
        }}
      >
        <span>
          <Icon name="icon/money" /> {clock.money.toLocaleString('ja-JP')}
        </span>
        <span>
          <Icon name="icon/star" /> {reputation}
        </span>
        <span>
          <Icon name="icon/calendar" /> {t('ui.hud.date', { year: date.year, month: date.month, day: date.day, hour: date.hour })}
        </span>
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
        <button style={{ ...hudButton(false), marginLeft: 'auto' }} onClick={() => setPopup('menu')}>
          <Icon name="icon/menu" scale={1} />
        </button>
      </header>
      <TaskPanel />
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
          {message && <div style={{ marginTop: 6, fontSize: 13 }}>{message}</div>}
        </Modal>
      )}
      {popup === 'help' && <KeyHelp onClose={() => setPopup(null)} />}
      {popup === 'settings' && <SettingsPanel onClose={() => setPopup(null)} onOpenKeys={() => setPopup('help')} />}
      <NoticeToast />
      {speedNote && (
        <div
          style={{
            position: 'absolute',
            top: 48,
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
