// ゲームの場面のポップアップ（メニュー・設定・キーの一覧・サンドボックスの広さ）。どれを開くかは useUiStore の popup が決める。
import { useEffect, useState } from 'react';
import { t } from '../../i18n/t';
import { saveSession, useSaveSession } from '../../services/saveSession';
import { useGameStore } from '../../stores/useGameStore';
import { useUiStore } from '../../stores/useUiStore';
import { RADIUS } from '../../ui/theme';
import { dangerButton, Modal, secondaryButton } from '../Modal';
import { KeyHelp } from '../KeyHelp';
import { SandboxSizePanel } from '../SandboxSizePanel';
import { SettingsPanel } from '../SettingsPanel';
import { LessonPicker } from '../LessonPicker';

// メニューの項目。ボタンとファイルを選ぶラベルで、文字の大きさと見た目をそろえる
const menuButton = { ...secondaryButton, display: 'block', width: '100%', margin: '4px 0', padding: '6px 12px', fontSize: 13, lineHeight: 1.4, boxSizing: 'border-box' } as const;

export function GamePopups({ onExit }: { onExit: () => void }) {
  const popup = useUiStore((s) => s.popup);
  const setPopup = useUiStore.getState().setPopup;
  const sandbox = useGameStore((s) => s.mode) === 'sandbox';
  const officeSize = useGameStore((s) => s.office.size);
  // メニューに出す知らせ（保存・読み込みの結果）
  const [message, setMessage] = useState('');

  // 自動保存に失敗したときは知らせる（黙って続けない・N133）
  const saveFailed = useSaveSession((s) => s.failed);
  useEffect(() => {
    if (!saveFailed) return;
    setMessage(t('ui.save.failed'));
    saveSession.acknowledgeFailure();
  }, [saveFailed]);

  const onSave = async () => {
    // 倒産した後は保存しない（倒産の前の保存を上書きしない）
    if (await saveSession.save()) setMessage(t('ui.save.done'));
  };

  const onExport = () => {
    const text = saveSession.exportText();
    if (text === null) return;
    const blob = new Blob([text], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'my-network-guy-save.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const onImport = async (file: File) => {
    try {
      saveSession.importText(await file.text());
      setMessage(t('ui.import.done'));
    } catch (e) {
      setMessage(t('ui.import.failed', { reason: (e as Error).message }));
    }
  };

  return (
    <>
      {popup === 'menu' && (
        <Modal onClose={() => setPopup(null)} boxStyle={{ minWidth: 200 }}>
          <button style={menuButton} onClick={onSave}>{t('ui.save')}</button>
          <button style={menuButton} onClick={onExport}>{t('ui.export')}</button>
          <label style={{ ...menuButton, textAlign: 'center' }}>
            {t('ui.import')}
            <input type="file" accept="application/json" style={{ display: 'none' }} onChange={(e) => e.target.files?.[0] && onImport(e.target.files[0])} />
          </label>
          <button style={menuButton} onClick={() => setPopup('settings')}>
            {t('ui.menu.settings')}
          </button>
          <button style={menuButton} onClick={onExit}>
            {t('ui.title.back')}
          </button>
          {sandbox && (
            <>
              <button style={menuButton} onClick={() => setPopup('lessons')}>
                {t('ui.lesson.open')}
              </button>
              <button style={menuButton} onClick={() => setPopup('sandboxResize')}>
                {t('ui.sandbox.size.change')}
              </button>
              <button style={menuButton} onClick={() => setPopup('sandboxResetConfirm')}>
                {t('ui.sandbox.size.reset')}
              </button>
            </>
          )}
          {message && <div style={{ marginTop: 6, fontSize: 13 }}>{message}</div>}
        </Modal>
      )}
      {popup === 'sandboxResize' && (
        <SandboxSizePanel
          title={t('ui.sandbox.size.change')}
          start={t('ui.sandbox.size.apply')}
          current={officeSize}
          onClose={() => setPopup(null)}
          submit={(size) => {
            const reason = useGameStore.getState().resizeSandbox(size);
            return reason === null ? null : t('ui.sandbox.size.blocked');
          }}
        />
      )}
      {popup === 'sandboxResetConfirm' && (
        // Enter で作り直しの広さを選ぶ画面へ進み、Esc で取り消す
        <Modal onClose={() => setPopup(null)} primary={() => setPopup('sandboxReset')} boxStyle={{ minWidth: 240 }}>
          <div style={{ fontWeight: 'bold', marginBottom: 12 }}>{t('ui.sandbox.size.resetConfirm')}</div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              style={{ padding: '4px 12px', cursor: 'pointer', background: 'transparent', color: '#f4f1e6', border: '1px solid #f4f1e6', borderRadius: RADIUS.none }}
              onClick={() => setPopup(null)}
            >
              {t('ui.sandbox.size.cancel')}
            </button>
            <button style={dangerButton} onClick={() => setPopup('sandboxReset')}>
              {t('ui.sandbox.size.recreate')}
            </button>
          </div>
        </Modal>
      )}
      {popup === 'sandboxReset' && (
        <SandboxSizePanel
          title={t('ui.sandbox.size.reset')}
          start={t('ui.sandbox.size.start')}
          onClose={() => setPopup(null)}
          submit={(size) => {
            useGameStore.getState().newSandbox(size);
            return null;
          }}
        />
      )}
      {popup === 'lessons' && <LessonPicker onClose={() => setPopup(null)} />}
      {popup === 'help' && <KeyHelp onClose={() => setPopup(null)} />}
      {popup === 'settings' && <SettingsPanel onClose={() => setPopup(null)} onOpenKeys={() => setPopup('help')} />}
    </>
  );
}
