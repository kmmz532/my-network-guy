// キー操作の一覧。キーの表（input/keymap.ts）から作る。Enter と Esc で閉じる
import { KEYMAP } from '../input/keymap';
import { t } from '../i18n/t';
import { Modal, primaryButton } from './Modal';

export function KeyHelp({ onClose }: { onClose: () => void }) {
  return (
    <Modal onClose={onClose} primary={onClose} boxStyle={{ width: 'min(420px, calc(100% - 32px))' }}>
      <div style={{ fontWeight: 'bold', marginBottom: 8 }}>{t('ui.help.title')}</div>
      <div style={{ maxHeight: 'min(60vh, 480px)', overflowY: 'auto' }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th style={{ padding: '2px 12px 4px 0', fontWeight: 'bold' }}>{t('ui.help.key')}</th>
              <th style={{ padding: '2px 0 4px', fontWeight: 'bold' }}>{t('ui.help.action')}</th>
            </tr>
          </thead>
          <tbody>
            {KEYMAP.map((b, i) => (
              <tr key={i}>
                <td style={{ padding: '2px 12px 2px 0', whiteSpace: 'nowrap' }}>
                  <kbd>{b.key}</kbd>
                </td>
                <td style={{ padding: '2px 0' }}>{t(b.name)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button style={{ ...primaryButton, display: 'block', marginTop: 10, marginLeft: 'auto' }} onClick={onClose}>
        {t('ui.panel.close')}
      </button>
    </Modal>
  );
}
