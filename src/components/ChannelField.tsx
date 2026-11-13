// 口のリンクアグリゲーションの欄（チャネルの番号とモード）。ターミナルの channel-group と同じ操作
import { t } from '../i18n/t';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { inputStyle } from './devicePorts';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0', fontSize: 12 } as const;
type Mode = 'none' | 'active' | 'passive' | 'on';

export function ChannelField({ node, port, disabled, onError }: { node: NetNode; port: number; disabled: boolean; onError: (reason: string | null) => void }) {
  const setChannel = useGameStore((s) => s.setChannel);
  const cfg = node.ports.find((p) => p.port === port);
  const mode: Mode = cfg?.channelGroup === undefined ? 'none' : (cfg.lacp ?? 'active');
  return (
    <div style={row}>
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        {t('ui.config.channel')}
        <select
          aria-label={t('ui.config.channel')}
          value={mode}
          disabled={disabled}
          onChange={(e) => {
            const next = e.target.value as Mode;
            onError(next === 'none' ? setChannel(node.uid, { port, group: null }) : setChannel(node.uid, { port, group: cfg?.channelGroup ?? 1, lacp: next }));
          }}
        >
          <option value="none">{t('ui.config.channelNone')}</option>
          <option value="active">active</option>
          <option value="passive">passive</option>
          <option value="on">on</option>
        </select>
      </label>
      {cfg?.channelGroup !== undefined && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {t('ui.config.channelGroup')}
          <input
            type="number"
            min={1}
            max={64}
            key={`${port}-${cfg.channelGroup}`}
            defaultValue={cfg.channelGroup}
            disabled={disabled}
            style={{ ...inputStyle, width: 56 }}
            onBlur={(e) => {
              const v = Number(e.target.value);
              if (Number.isInteger(v) && v !== cfg.channelGroup) onError(setChannel(node.uid, { port, group: v, lacp: cfg.lacp ?? 'active' }));
            }}
          />
        </label>
      )}
    </div>
  );
}
