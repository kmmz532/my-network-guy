// 時間が止まっているときに施工を依頼したときの確認。主のボタンは「1倍で進める」、もう1つは「止めたまま」。
// Enter で主のボタン、Esc と背景で「止めたまま」。「今後この確認を出さない」は、選んだ扱いを設定に残す。
import { useState } from 'react';
import { t } from '../i18n/t';
import { useGameStore } from '../stores/useGameStore';
import { Modal, primaryButton, secondaryButton } from './Modal';
import { PixelCheck } from './PixelControls';

export function PausedBuildPrompt() {
  const answer = useGameStore((s) => s.answerPausedBuild);
  const [remember, setRemember] = useState(false);
  return (
    <Modal
      primary={() => answer('play', remember)}
      onClose={() => answer('stay', remember)}
      boxStyle={{ minWidth: 240 }}
    >
      <div style={{ fontWeight: 'bold', marginBottom: 12 }}>{t('ui.paused.build.title')}</div>
      <div style={{ fontSize: 13, marginBottom: 12 }}>
        <PixelCheck checked={remember} onChange={setRemember}>
          {t('ui.paused.build.remember')}
        </PixelCheck>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button style={secondaryButton} onClick={() => answer('stay', remember)}>
          {t('ui.paused.build.stay')}
        </button>
        <button style={primaryButton} onClick={() => answer('play', remember)}>
          {t('ui.paused.build.play')}
        </button>
      </div>
    </Modal>
  );
}
