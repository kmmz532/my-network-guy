// 時間が止まっているときに施工を依頼したときの確認。主のボタンは「1倍で進める」、もう1つは「止めたまま」。
// Enter で主のボタン、Esc と背景で「止めたまま」。「今後この確認を出さない」は、選んだ扱いを設定に残す。
import { useState } from 'react';
import { t } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { PixelCheck } from './PixelControls';

export function PausedBuildPrompt() {
  const answer = useGameStore((s) => s.answerPausedBuild);
  const [remember, setRemember] = useState(false);
  return (
    <ConfirmDialog
      onCancel={() => answer('stay', remember)}
      cancelLabel={t('ui.paused.build.stay')}
      action={{ label: t('ui.paused.build.play'), tone: 'primary', onClick: () => answer('play', remember) }}
      layout={{ minWidth: 240 }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 12 }}>{t('ui.paused.build.title')}</div>
      <div style={{ fontSize: 13 }}>
        <PixelCheck checked={remember} onChange={setRemember}>
          {t('ui.paused.build.remember')}
        </PixelCheck>
      </div>
    </ConfirmDialog>
  );
}
