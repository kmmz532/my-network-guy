// SVI（VLAN のインターフェース）の欄（NET.md §5.2）。L3スイッチなど svi を持つ機器に、VLAN ごとのアドレスを設定する。
// ターミナルの `ip address vlan <番号> <IP> <マスク>` と同じ操作
import { useState } from 'react';
import { t } from '../i18n/t';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { isIpText } from './devicePorts';
import { Button } from './ui/Button';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

export function SviField({ node, disabled, onError }: { node: NetNode; disabled: boolean; onError: (reason: string | null) => void }) {
  const setSvi = useGameStore((s) => s.setSvi);
  const [vlan, setVlan] = useState('');
  const [ip, setIp] = useState('');
  const [prefix, setPrefix] = useState('24');
  const svis = node.interfaces.filter((i) => i.kind === 'svi').sort((a, b) => (a.vlan ?? 0) - (b.vlan ?? 0));
  const addable = /^\d+$/.test(vlan) && isIpText(ip) && /^\d+$/.test(prefix) && Number(prefix) >= 8 && Number(prefix) <= 30;
  return (
    <div style={{ margin: '8px 0' }}>
      <Text size="s">
      <Text tone="note" size="s">{t('ui.config.svi')}</Text>
      {svis.map((i) => (
        <div key={i.id} style={row}>
          <b>{i.id}</b>
          <span>{i.ip}/{i.prefix}</span>
          <Button variant="secondary" size="fit" disabled={disabled} onClick={() => onError(setSvi(node.uid, i.vlan ?? 0, '', i.prefix))}>
            {t('ui.config.vrrpRemove')}
          </Button>
        </div>
      ))}
      <div style={row}>
        <TextInput label="VLAN" placeholder="VLAN" value={vlan} disabled={disabled} onChange={setVlan} layout={{ width: 56 }} />
        <TextInput label="IP" placeholder="IP" value={ip} disabled={disabled} onChange={setIp} layout={{ width: 120 }} />
        <TextInput label={t('ui.config.prefix')} value={prefix} disabled={disabled} onChange={setPrefix} layout={{ width: 40 }} />
        <Button
          variant="secondary"
          size="fit"
          disabled={disabled || !addable}
          onClick={() => {
            const reason = setSvi(node.uid, Number(vlan), ip, Number(prefix));
            onError(reason);
            if (reason === null) {
              setVlan('');
              setIp('');
            }
          }}
        >
          {t('ui.config.sviAdd')}
        </Button>
      </div>
      </Text>
    </div>
  );
}
