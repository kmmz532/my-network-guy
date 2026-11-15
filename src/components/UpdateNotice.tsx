// 新しい版があるときの通知。押したときだけ更新する（操作を止めず、画面の下に出す）
import { useEffect, useState } from 'react';
import { t } from '../i18n/t';
import { applyUpdate, subscribeUpdate } from '../pwa/update';
import { Button } from './ui/Button';
import { Notice } from './ui/Notice';

export function UpdateNotice() {
  const [ready, setReady] = useState(false);
  useEffect(() => subscribeUpdate(setReady), []);
  if (!ready) return null;
  return (
    <div style={{ position: 'absolute', bottom: 60, left: '50%', transform: 'translateX(-50%)', zIndex: 6 }}>
      <Notice tone="card" role="status">
        <span>{t('ui.update.ready')}</span>
        <Button variant="notify" onClick={applyUpdate}>
          {t('ui.update.apply')}
        </Button>
      </Notice>
    </div>
  );
}
