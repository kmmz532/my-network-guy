// 設定の画面（メニューの「設定」から開く）。項目は端末ごとに保存する（settings/settings.ts）。
// 名前とIPアドレスの表示は、ツールバーの「IP」ボタンと同じ値（ストアの showIp）を使う。
import { useEffect, useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { applyUiScale, AUTO_SAVE_MODES, loadSettings, PAUSED_BUILD_MODES, saveSettings, START_SPEEDS, UI_SCALES, type Settings } from '../settings/settings';
import { useGameStore } from '../stores/useGameStore';
import { Button } from './ui/Button';
import { Choice } from './ui/Choice';
import { Dialog } from './ui/Dialog';

// 項目の名前と、その右下の選択肢
function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ marginBottom: 4, fontWeight: 'bold' }}>{label}</div>
      {children}
    </div>
  );
}

export function SettingsPanel({ onClose, onOpenKeys }: { onClose: () => void; onOpenKeys: () => void }) {
  const [settings, setSettings] = useState<Settings>(loadSettings);
  // 保存（会社の枠）が、ブラウザに守られているか（N133）
  const [kept, setKept] = useState<boolean | null>(null);
  useEffect(() => {
    let alive = true;
    void navigator.storage?.persisted?.().then((v) => alive && setKept(v)).catch(() => alive && setKept(false));
    return () => {
      alive = false;
    };
  }, []);
  const showIp = useGameStore((s) => s.showIp);
  const showNames = useGameStore((s) => s.showNames);
  const setShowNames = useGameStore((s) => s.setShowNames);
  const setShowIp = useGameStore((s) => s.setShowIp);

  const update = (patch: Partial<Settings>) => {
    setSettings(saveSettings(patch));
    if (patch.uiScale !== undefined) applyUiScale(patch.uiScale);
  };

  return (
    <Dialog onClose={onClose} primary={onClose} layout={{ width: 'min(380px, calc(100% - 32px))', maxHeight: 'calc(100% - 32px)', overflowY: 'auto' }}>
      <div style={{ fontWeight: 'bold' }}>{t('ui.settings.title')}</div>
      <Row label={t('ui.settings.saveKeep')}>
        <span style={{ fontSize: 13 }}>{kept === null ? '…' : kept ? t('ui.settings.saveKept') : t('ui.settings.saveNotKept')}</span>
      </Row>
      <Row label={t('ui.settings.uiScale')}>
        <Choice
          options={UI_SCALES.map((v) => ({ value: v, label: `${Math.round(v * 100)}%` }))}
          value={settings.uiScale}
          onChange={(v) => update({ uiScale: v })}
        />
      </Row>
      <Row label={t('ui.settings.guide')}>
        <Choice
          options={[
            { value: true, label: t('ui.settings.guide.on') },
            { value: false, label: t('ui.settings.guide.off') },
          ]}
          value={settings.guide}
          onChange={(v) => update({ guide: v })}
        />
      </Row>
      <Row label={t('ui.settings.showIp')}>
        <Choice
          options={[
            { value: true, label: t('ui.settings.showIp.on') },
            { value: false, label: t('ui.settings.showIp.off') },
          ]}
          value={showIp}
          onChange={setShowIp}
        />
      </Row>
      <Row label={t('ui.settings.showNames')}>
        <Choice
          options={[
            { value: true, label: t('ui.settings.showNames.on') },
            { value: false, label: t('ui.settings.showNames.off') },
          ]}
          value={showNames}
          onChange={setShowNames}
        />
      </Row>
      <Row label={t('ui.settings.speed')}>
        <Choice
          options={START_SPEEDS.map((v) => ({ value: v, label: t(`ui.speed.${v}` as const) }))}
          value={settings.startSpeed}
          onChange={(v) => update({ startSpeed: v })}
        />
      </Row>
      <Row label={t('ui.settings.pausedBuild')}>
        <Choice
          options={PAUSED_BUILD_MODES.map((v) => ({ value: v, label: t(`ui.settings.pausedBuild.${v}` as const) }))}
          value={settings.pausedBuild}
          onChange={(v) => update({ pausedBuild: v })}
        />
      </Row>
      <Row label={t('ui.settings.autoIp')}>
        <Choice
          options={[
            { value: true, label: t('ui.settings.autoIp.on') },
            { value: false, label: t('ui.settings.autoIp.off') },
          ]}
          value={settings.autoIp}
          onChange={(v) => update({ autoIp: v })}
        />
      </Row>
      <Row label={t('ui.settings.confirmDecline')}>
        <Choice
          options={[
            { value: true, label: t('ui.settings.confirmDecline.on') },
            { value: false, label: t('ui.settings.confirmDecline.off') },
          ]}
          value={settings.confirmDecline}
          onChange={(v) => update({ confirmDecline: v })}
        />
      </Row>
      <Row label={t('ui.settings.designPause')}>
        <Choice
          options={[
            { value: true, label: t('ui.settings.designPause.on') },
            { value: false, label: t('ui.settings.designPause.off') },
          ]}
          value={settings.designPause}
          onChange={(v) => update({ designPause: v })}
        />
      </Row>
      <Row label={t('ui.settings.sound')}>
        <Choice
          options={[
            { value: true, label: t('ui.settings.sound.on') },
            { value: false, label: t('ui.settings.sound.off') },
          ]}
          value={settings.sound}
          onChange={(v) => update({ sound: v })}
        />
      </Row>
      <Row label={t('ui.settings.dayTint')}>
        <Choice
          options={[
            { value: true, label: t('ui.settings.dayTint.on') },
            { value: false, label: t('ui.settings.dayTint.off') },
          ]}
          value={settings.dayTint}
          onChange={(v) => update({ dayTint: v })}
        />
      </Row>
      <Row label={t('ui.settings.payPause')}>
        <Choice
          options={[
            { value: true, label: t('ui.settings.payPause.on') },
            { value: false, label: t('ui.settings.payPause.off') },
          ]}
          value={settings.payPause}
          onChange={(v) => update({ payPause: v })}
        />
      </Row>
      <Row label={t('ui.settings.autoSave')}>
        <Choice
          options={AUTO_SAVE_MODES.map((v) => ({ value: v, label: t(`ui.settings.autoSave.${v}` as const) }))}
          value={settings.autoSave}
          onChange={(v) => update({ autoSave: v })}
        />
      </Row>
      <div style={{ marginTop: 14 }}>
        <Button variant="secondary" onClick={onOpenKeys}>
          {t('ui.settings.keys')}
        </Button>
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
        <Button variant="primary" onClick={onClose}>
          {t('ui.panel.close')}
        </Button>
      </div>
    </Dialog>
  );
}
