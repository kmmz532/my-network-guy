import { useEffect, useState } from 'react';
import { balance } from 'virtual:game-data';
import { loadLang, t } from './i18n/t';
import { PixiStage } from './game/PixiStage';
import { useGameStore, type Speed } from './stores/useGameStore';
import { useTickLoop } from './stores/useTickLoop';
import { toDate } from './sim/clock';
import { loadSlot, saveSlot } from './services/db';
import { exportSave, importSave } from './services/saveFile';
import { ShopPanel } from './components/ShopPanel';
import { OfferPanel } from './components/OfferPanel';
import { ProjectPanel } from './components/ProjectPanel';
import { DesignPanel } from './components/DesignPanel';
import { ConfigPanel } from './components/ConfigPanel';
import { ProbePanel } from './components/ProbePanel';
import { GuidePanel } from './components/GuidePanel';
import { TitleScreen } from './components/TitleScreen';
import { mapLoaders } from 'virtual:loaders';

const SLOT = 1;
const SPEEDS: Speed[] = [0, 1, 2, 4];

type Screen = 'title' | 'game';

export function App() {
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>('title');
  const [message, setMessage] = useState('');
  const clock = useGameStore((s) => s.clock);
  const reputation = useGameStore((s) => s.reputation);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const load = useGameStore((s) => s.load);
  const snapshot = useGameStore((s) => s.snapshot);
  const newGame = useGameStore((s) => s.newGame);
  const cacheMap = useGameStore((s) => s.cacheMap);

  useTickLoop();

  useEffect(() => {
    // タイトル画面の間は時間を止める
    setSpeed(0);
    loadLang('ja_jp').then(() => setReady(true));
    mapLoaders.office_small().then((m) => cacheMap(m.default));
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

  const backToTitle = () => {
    setSpeed(0);
    setScreen('title');
  };

  if (screen === 'title') {
    return <TitleScreen onNew={onNew} onContinue={onContinue} message={message} />;
  }

  const date = toDate(clock.minute, balance);
  const button = { padding: '4px 10px', cursor: 'pointer' } as const;

  const onSave = async () => {
    await saveSlot(SLOT, snapshot());
    setMessage(t('ui.save.done'));
  };

  const onLoad = async () => {
    const data = await loadSlot(SLOT);
    if (!data) return setMessage(t('ui.load.empty'));
    load(data);
    setMessage(t('ui.import.done'));
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

  return (
    <div style={{ position: 'relative', width: '100vw', height: '100vh' }}>
      <PixiStage />
      <header
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: '8px 16px',
          background: 'rgba(47, 79, 143, 0.85)',
          color: '#f4f1e6',
          display: 'flex',
          flexWrap: 'wrap',
          gap: 16,
        }}
      >
        <span>{t('ui.hud.date', { month: date.month, day: date.day, hour: date.hour })}</span>
        <span>{t('ui.hud.money', { amount: clock.money.toLocaleString('ja-JP') })}</span>
        <span>{t('ui.hud.reputation', { value: reputation })}</span>
      </header>
      <div style={{ position: 'absolute', top: 56, left: 16 }}>
        <GuidePanel />
        <div style={{ height: 8 }} />
        <DesignPanel />
        <div style={{ height: 8 }} />
        <ConfigPanel />
      </div>
      <div style={{ position: 'absolute', top: 56, right: 16 }}>
        <ShopPanel />
        <div style={{ height: 8 }} />
        <OfferPanel />
        <div style={{ height: 8 }} />
        <ProjectPanel />
        <div style={{ height: 8 }} />
        <ProbePanel />
      </div>
      <footer
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '8px 16px',
          background: 'rgba(47, 79, 143, 0.85)',
          color: '#f4f1e6',
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 8,
        }}
      >
        {SPEEDS.map((s) => (
          <button
            key={s}
            style={{ ...button, fontWeight: speed === s ? 'bold' : 'normal' }}
            onClick={() => setSpeed(s)}
          >
            {t(`ui.speed.${s}` as const)}
          </button>
        ))}
        <button style={button} onClick={onSave}>{t('ui.save')}</button>
        <button style={button} onClick={onLoad}>{t('ui.load')}</button>
        <button style={button} onClick={onExport}>{t('ui.export')}</button>
        <label style={button}>
          {t('ui.import')}
          <input
            type="file"
            accept="application/json"
            style={{ display: 'none' }}
            onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])}
          />
        </label>
        <button style={button} onClick={backToTitle}>{t('ui.title.back')}</button>
        <span>{message}</span>
      </footer>
      {clock.bankrupt && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(20, 20, 30, 0.8)',
            color: '#f4f1e6',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
          }}
        >
          <h2 style={{ fontSize: 28, margin: 0 }}>{t('ui.gameover.title')}</h2>
          <p>{t('ui.gameover.body')}</p>
          <button style={{ ...button, padding: '10px 24px', fontSize: 16 }} onClick={onNew}>
            {t('ui.gameover.retry')}
          </button>
        </div>
      )}
    </div>
  );
}
