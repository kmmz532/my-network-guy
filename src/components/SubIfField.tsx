// サブインターフェース（router-on-a-stick・NET.md §5.2）の欄。subif を持つ機器（ルーター）の1つの口に、VLAN ごとのアドレスを持たせる。
// ターミナルの `interface g0/<口>.<VLAN>` / `encapsulation dot1q <VLAN>` / `ip address <IP> <マスク>` と同じ操作
import { useState } from 'react';
import { t } from '../i18n/t';
import type { NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { isIpText } from './devicePorts';
import { Button } from './ui/Button';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

export function SubIfField({ node, disabled, onError }: { node: NetNode; disabled: boolean; onError: (reason: string | null) => void }) {
  const setSub = useGameStore((s) => s.setSub);
  const [parent, setParent] = useState('0');
  const [vlan, setVlan] = useState('');
  const [ip, setIp] = useState('');
  const [prefix, setPrefix] = useState('24');
  const subs = node.interfaces.filter((i) => i.kind === 'sub').sort((a, b) => (a.parent ?? 0) - (b.parent ?? 0) || (a.vlan ?? 0) - (b.vlan ?? 0));
  const addable = /^\d+$/.test(parent) && /^\d+$/.test(vlan) && isIpText(ip) && /^\d+$/.test(prefix) && Number(prefix) >= 8 && Number(prefix) <= 30;
  return (
    <div style={{ margin: '8px 0' }}>
      <Text size="s">
        <Text tone="note" size="s">{t('ui.config.subif')}</Text>
        {subs.map((i) => (
          <div key={i.id} style={row}>
            <b>{i.id}</b>
            <span>{t('ui.config.subifVlan', { vlan: i.vlan ?? 0 })}</span>
            <span>{i.ip}/{i.prefix}</span>
            <Button variant="secondary" size="fit" disabled={disabled} onClick={() => onError(setSub(node.uid, i.parent ?? 0, i.vlan ?? 0, '', i.prefix))}>
              {t('ui.config.vrrpRemove')}
            </Button>
          </div>
        ))}
        <div style={row}>
          <TextInput label={t('ui.config.subifParent')} placeholder={t('ui.config.subifParent')} value={parent} disabled={disabled} onChange={setParent} layout={{ width: 40 }} />
          <TextInput label="VLAN" placeholder="VLAN" value={vlan} disabled={disabled} onChange={setVlan} layout={{ width: 56 }} />
          <TextInput label="IP" placeholder="IP" value={ip} disabled={disabled} onChange={setIp} layout={{ width: 120 }} />
          <TextInput label={t('ui.config.prefix')} value={prefix} disabled={disabled} onChange={setPrefix} layout={{ width: 40 }} />
          <Button
            variant="secondary"
            size="fit"
            disabled={disabled || !addable}
            onClick={() => {
              const reason = setSub(node.uid, Number(parent), Number(vlan), ip, Number(prefix));
              onError(reason);
              if (reason === null) {
                setVlan('');
                setIp('');
              }
            }}
          >
            {t('ui.config.subifAdd')}
          </Button>
        </div>
      </Text>
    </div>
  );
}
