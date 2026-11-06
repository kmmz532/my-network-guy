// 新しい版があるときの通知。押したときだけ更新する（操作を止めず、画面の下に出す）
import { useEffect, useState } from 'react';
import { t } from '../i18n/t';
import { applyUpdate, subscribeUpdate } from '../pwa/update';

export function UpdateNotice() {
  const [ready, setReady] = useState(false);
  useEffect(() => subscribeUpdate(setReady), []);
  if (!ready) return null;
  return (
    <div
      role="status"
      style={{
        position: 'absolute',
        bottom: 60,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 6,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '6px 12px',
        background: '#25406f',
        color: '#f4f1e6',
        fontSize: 13,
        whiteSpace: 'nowrap',
      }}
    >
      <span>{t('ui.update.ready')}</span>
      <button
        onClick={applyUpdate}
        style={{ padding: '2px 10px', cursor: 'pointer', background: '#3a7bd0', color: '#f4f1e6', border: 'none', fontFamily: 'inherit' }}
      >
        {t('ui.update.apply')}
      </button>
    </div>
  );
}
