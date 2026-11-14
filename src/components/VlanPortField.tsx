// 口の VLAN の設定欄（access の VLAN、trunk の許可する VLAN と native VLAN）。設定のない口は既定の VLAN 1（access）
import { useState } from 'react';
import { t } from '../i18n/t';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { greyColor, inputStyle } from './devicePorts';
import { Select } from './ui/Select';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0', fontSize: 12 } as const;
const parseList = (text: string): number[] | null | 'error' => {
  if (text.trim() === '' || text.trim() === 'all') return null;
  const list = text.split(',').map((x) => Number(x.trim()));
  return list.every((v) => Number.isInteger(v) && v >= 1 && v <= 4094) ? list : 'error';
};

export function VlanPortField({ node, port, readOnly, onError }: { node: NetNode; port: number; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setPortMode = useGameStore((s) => s.setPortMode);
  const cfg = node.ports.find((p) => p.port === port);
  const mode = cfg?.mode === 'trunk' ? 'trunk' : 'access';
  const [allowed, setAllowed] = useState(cfg?.allowed?.join(',') ?? '');
  const numberField = (label: string, value: number, apply: (v: number) => string | null) => (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      {label}
      <input
        type="number"
        min={1}
        max={4094}
        key={`${label}-${value}`}
        defaultValue={value}
        disabled={readOnly}
        style={{ ...inputStyle, width: 60 }}
        onBlur={(e) => {
          const v = Number(e.target.value);
          if (Number.isInteger(v) && v !== value) onError(apply(v));
        }}
      />
    </label>
  );
  return (
    <div style={row}>
      <Select
        label={t('ui.config.vlanMode')}
        value={mode}
        disabled={readOnly}
        options={[
          { value: 'access', label: t('ui.config.vlanAccess') },
          { value: 'trunk', label: t('ui.config.vlanTrunk') },
        ]}
        onChange={(v) => onError(setPortMode(node.uid, port, v === 'trunk' ? { kind: 'trunk' } : { kind: 'access', vlan: cfg?.vlan ?? 1 }))}
      />
      {mode === 'access' && numberField('VLAN', cfg?.vlan ?? 1, (v) => setPortMode(node.uid, port, { kind: 'access', vlan: v }))}
      {mode === 'trunk' && (
        <>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {t('ui.config.vlanAllowed')}
            <input
              style={{ ...inputStyle, width: 110 }}
              value={allowed}
              placeholder="all"
              disabled={readOnly}
              onChange={(e) => setAllowed(e.target.value)}
              onBlur={() => {
                const list = parseList(allowed);
                if (list === 'error') return onError('vlan.range');
                onError(setPortMode(node.uid, port, { kind: 'trunk', allowed: list }));
              }}
            />
          </label>
          {numberField(t('ui.config.vlanNative'), cfg?.native ?? 1, (v) => setPortMode(node.uid, port, { kind: 'trunk', native: v }))}
        </>
      )}
      <span style={{ color: greyColor }}>{t('ui.config.vlanNote')}</span>
    </div>
  );
}
