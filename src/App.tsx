import { useEffect, useState } from 'react';
import { balance } from 'virtual:game-data';
import { loadLang, t } from './i18n/t';
import { PixiStage } from './game/PixiStage';

export function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    loadLang('ja_jp').then(() => setReady(true));
  }, []);

  if (!ready) return null;

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
          gap: 16,
        }}
      >
        <span>{t('ui.hud.money', { amount: balance.startMoney.toLocaleString('ja-JP') })}</span>
        <span>{t('ui.hud.reputation', { value: 0 })}</span>
      </header>
    </div>
  );
}
