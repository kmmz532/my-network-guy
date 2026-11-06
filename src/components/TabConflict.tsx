// 別のタブで同じゲームを開いているときの表示（N27）。続けるまで、この画面の操作を止める
import { useEffect, useState } from 'react';
import { t } from '../i18n/t';
import { startTabGuard } from '../services/tabGuard';

export function TabConflict() {
  const [conflict, setConflict] = useState(false);
  const [continued, setContinued] = useState(false);
  useEffect(() => startTabGuard(() => setConflict(true)), []);
  if (!conflict || continued) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{ position: 'absolute', inset: 0, zIndex: 50, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(29, 54, 100, 0.85)' }}
    >
      <div style={{ background: '#25406f', color: '#f4f1e6', border: '1px solid #3b2a33', padding: 20, maxWidth: 360, lineHeight: 1.6 }}>
        <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{t('ui.tab.conflict.title')}</div>
        <div style={{ fontSize: 14, marginBottom: 12 }}>{t('ui.tab.conflict.body')}</div>
        <button
          onClick={() => setContinued(true)}
          style={{ padding: '6px 14px', cursor: 'pointer', background: '#ffd866', color: '#1d3664', border: 'none', fontWeight: 'bold', fontFamily: 'inherit' }}
        >
          {t('ui.tab.conflict.continue')}
        </button>
      </div>
    </div>
  );
}
