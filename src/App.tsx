import { useEffect, useState } from 'react';
import { balance, furniture } from 'virtual:game-data';
import type { FurnitureId } from './generated/ids';
import type { LangKey } from './generated/lang-keys';
import { seatCount } from './sim/furniture';
import { loadLang, t } from './i18n/t';
import { PixiStage } from './game/PixiStage';
import { useGameStore, type Speed } from './stores/useGameStore';
import { useTickLoop } from './stores/useTickLoop';
import { toDate } from './sim/clock';
import { loadSlot, saveSlot } from './services/db';
import { exportSave, importSave } from './services/saveFile';
import { modalBack, modalBox, NoticeToast, ReportModal } from './components/Overlay';
import { OfferCards } from './components/OfferCards';
import { Toolbar } from './components/Toolbar';
import { TaskPanel } from './components/TaskPanel';
import { ConfigPanel } from './components/ConfigPanel';
import { ShopCards } from './components/ShopCards';
import { Icon } from './components/Icon';
import { TitleScreen } from './components/TitleScreen';
import { mapLoaders } from 'virtual:loaders';

const SLOT = 1;
const SPEEDS: Speed[] = [0, 1, 2, 4];

type Screen = 'title' | 'game';
type Popup = 'offers' | 'shop' | 'menu' | null;

const hudButton = (on: boolean) =>
  ({
    padding: '2px 8px',
    cursor: 'pointer',
    background: on ? '#ffd866' : '#25406f',
    color: on ? '#3b2a33' : '#f4f1e6',
    border: '1px solid #3b2a33',
    borderRadius: 3,
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
  const load = useGameStore((s) => s.load);
  const snapshot = useGameStore((s) => s.snapshot);
  const newGame = useGameStore((s) => s.newGame);
  // 社員の人数と席の数（席は自社オフィスの机の家具）。雇えなかった理由をHUDに出す
  const staff = useGameStore((s) => s.staff);
  const seats = useGameStore((s) => seatCount(s.office, (id) => furniture[id as FurnitureId]?.seat === true));
  const hire = useGameStore((s) => s.hire);
  const [hireMessage, setHireMessage] = useState('');
  const cacheMap = useGameStore((s) => s.cacheMap);

  useTickLoop();

  useEffect(() => {
    // タイトル画面の間は時間を止める
    setSpeed(0);
    loadLang('ja_jp').then(() => setReady(true));
    mapLoaders.office_small().then((m) => cacheMap(m.default));
    mapLoaders.hq().then((m) => cacheMap(m.default));
  }, []);

  // 受注した案件のマップは、配置や描画のために読み込んでおく
  const activeMap = useGameStore((s) => s.active?.contract.map);
  useEffect(() => {
    if (activeMap && !useGameStore.getState().maps[activeMap]) {
      mapLoaders[activeMap as keyof typeof mapLoaders]().then((m) => cacheMap(m.default));
    }
  }, [activeMap]);

  if (!ready) return null;

  const startGame = () => {
    setMessage('');
    setSpeed(1);
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
    a.download = 'network-ya-save.json';
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

  const menuButton = { display: 'block', width: '100%', margin: '4px 0', padding: '6px 12px', cursor: 'pointer' } as const;

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
        }}
      >
        <span>
          <Icon name="icon/money" /> {clock.money.toLocaleString('ja-JP')}
        </span>
        <span>
          <Icon name="icon/star" /> {reputation}
        </span>
        <span>
          <Icon name="icon/calendar" /> {t('ui.hud.date', { month: date.month, day: date.day, hour: date.hour })}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {t('ui.staff.label', { staff, seats })}
          <button
            style={hudButton(false)}
            disabled={staff >= seats}
            onClick={() => {
              const reason = hire();
              setHireMessage(reason ? t(`ui.error.${reason}` as LangKey) : '');
            }}
          >
            {t('ui.staff.hire')}
          </button>
          {staff >= seats && <span style={{ color: '#ffd866' }}>{t('ui.error.seat')}</span>}
          {hireMessage && staff < seats && <span style={{ color: '#ffd866' }}>{hireMessage}</span>}
        </span>
        <span style={{ display: 'flex', gap: 4 }}>
          {SPEEDS.map((s) => (
            <button key={s} style={hudButton(speed === s)} title={t(`ui.speed.${s}` as const)} onClick={() => setSpeed(s)}>
              {s === 0 ? (
                <Icon name="icon/pause" scale={1} />
              ) : (
                Array.from({ length: s === 4 ? 3 : s }, (_, i) => <Icon key={i} name="icon/play" scale={1} />)
              )}
            </button>
          ))}
        </span>
        <button style={{ ...hudButton(false), marginLeft: 'auto' }} onClick={() => setPopup('menu')}>
          <Icon name="icon/menu" scale={1} />
        </button>
      </header>
      <TaskPanel />
      <ConfigPanel />
      <Toolbar onOffers={() => setPopup('offers')} onShop={() => setPopup('shop')} />
      {popup === 'offers' && <OfferCards onClose={() => setPopup(null)} />}
      {popup === 'shop' && <ShopCards onClose={() => setPopup(null)} />}
      {popup === 'menu' && (
        <div style={modalBack} onClick={() => setPopup(null)}>
          <div style={{ ...modalBox, minWidth: 200 }} onClick={(e) => e.stopPropagation()}>
            <button style={menuButton} onClick={onSave}>{t('ui.save')}</button>
            <button style={menuButton} onClick={onExport}>{t('ui.export')}</button>
            <label style={{ ...menuButton, textAlign: 'center', background: '#efefef', color: '#000', boxSizing: 'border-box' }}>
              {t('ui.import')}
              <input
                type="file"
                accept="application/json"
                style={{ display: 'none' }}
                onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
              />
            </label>
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
          </div>
        </div>
      )}
      <NoticeToast />
      <ReportModal />
      {clock.bankrupt && (
        <div style={{ ...modalBack, background: 'rgba(20, 20, 30, 0.8)', flexDirection: 'column', gap: 12, color: '#f4f1e6' }}>
          <h2 style={{ fontSize: 28, margin: 0 }}>{t('ui.gameover.title')}</h2>
          <button style={{ padding: '10px 24px', fontSize: 16, cursor: 'pointer' }} onClick={onNew}>
            {t('ui.gameover.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
