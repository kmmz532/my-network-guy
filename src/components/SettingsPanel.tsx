// 設定の画面（メニューの「設定」から開く）。項目は端末ごとに保存する（settings/settings.ts）。
// 名前とIPアドレスの表示は、ツールバーの「IP」ボタンと同じ値（ストアの showIp）を使う。
import { useState, type ReactNode } from 'react';
import { t } from '../i18n/t';
import { applyUiScale, AUTO_SAVE_MODES, loadSettings, PAUSED_BUILD_MODES, saveSettings, START_SPEEDS, UI_SCALES, type Settings } from '../settings/settings';
import { useGameStore } from '../stores/useGameStore';
import { Modal, primaryButton, secondaryButton } from './Modal';
import { RADIUS } from '../ui/theme';

interface Option<T> {
  value: T;
  label: string;
}

// 選択肢のボタン。選んでいるものは反転した見た目にする
function Choice<T extends string | number | boolean>({
  options,
  value,
  onChange,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            aria-pressed={on}
            onClick={() => onChange(o.value)}
            style={{
              padding: '4px 10px',
              cursor: 'pointer',
              borderRadius: RADIUS.none,
              border: '1px solid #f4f1e6',
              background: on ? '#f4f1e6' : 'transparent',
              color: on ? '#2f4f8f' : '#f4f1e6',
              fontWeight: on ? 'bold' : 'normal',
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

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
  const showIp = useGameStore((s) => s.showIp);
  const setShowIp = useGameStore((s) => s.setShowIp);

  const update = (patch: Partial<Settings>) => {
    setSettings(saveSettings(patch));
    if (patch.uiScale !== undefined) applyUiScale(patch.uiScale);
  };

  return (
    <Modal onClose={onClose} primary={onClose} boxStyle={{ width: 'min(380px, calc(100% - 32px))' }}>
      <div style={{ fontWeight: 'bold' }}>{t('ui.settings.title')}</div>
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
      <Row label={t('ui.settings.autoSave')}>
        <Choice
          options={AUTO_SAVE_MODES.map((v) => ({ value: v, label: t(`ui.settings.autoSave.${v}` as const) }))}
          value={settings.autoSave}
          onChange={(v) => update({ autoSave: v })}
        />
      </Row>
      <div style={{ marginTop: 14 }}>
        <button style={secondaryButton} onClick={onOpenKeys}>
          {t('ui.settings.keys')}
        </button>
      </div>
      <button style={{ ...primaryButton, display: 'block', marginTop: 10, marginLeft: 'auto' }} onClick={onClose}>
        {t('ui.panel.close')}
      </button>
    </Modal>
  );
}
