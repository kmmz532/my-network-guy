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
import { mapLoaders } from 'virtual:loaders';

const SLOT = 1;
const SPEEDS: Speed[] = [0, 1, 2, 4];

export function App() {
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const clock = useGameStore((s) => s.clock);
  const reputation = useGameStore((s) => s.reputation);
  const speed = useGameStore((s) => s.speed);
  const setSpeed = useGameStore((s) => s.setSpeed);
  const load = useGameStore((s) => s.load);
  const snapshot = useGameStore((s) => s.snapshot);
  const cacheMap = useGameStore((s) => s.cacheMap);

  useTickLoop();

  useEffect(() => {
    loadLang('ja_jp').then(() => setReady(true));
    mapLoaders.office_small().then((m) => cacheMap(m.default));
  }, []);

  if (!ready) return null;

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
      <PixiStage mapId="office_small" />
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
      <div style={{ position: 'absolute', top: 56, right: 16 }}>
        <ShopPanel />
        <div style={{ height: 8 }} />
        <OfferPanel />
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
        <span>{message}</span>
        {clock.bankrupt && <strong>{t('ui.bankrupt')}</strong>}
      </footer>
    </div>
  );
}
