// 束ねた口（Po・ポートチャネル）の IP の欄。チャネルの番号ごとに、口の channelGroup で決まる Po の行を出す。
// ターミナルの `ip address` と `no ip address`（interface port-channel の中）と同じ操作
import { useState } from 'react';
import { t } from '../i18n/t';
import type { Iface, NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { isIpText } from './devicePorts';
import { Button } from './ui/Button';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

export function PoField({ node, disabled, onError }: { node: NetNode; disabled: boolean; onError: (reason: string | null) => void }) {
  const channels = [...new Set(node.ports.map((p) => p.channelGroup).filter((g): g is number => g !== undefined))].sort((a, b) => a - b);
  if (channels.length === 0) return null;
  return (
    <div style={{ margin: '8px 0' }}>
      <Text tone="note" size="s">{t('ui.config.po')}</Text>
      <Text size="s">
        {channels.map((channel) => (
          <PoRow key={channel} node={node} channel={channel} iface={node.interfaces.find((i) => i.kind === 'po' && i.channel === channel)} disabled={disabled} onError={onError} />
        ))}
      </Text>
    </div>
  );
}

// 1つのチャネルの行。IP があれば IP と削除の部品を出し、なければ IP・プレフィックス長と追加の部品を出す
function PoRow({ node, channel, iface, disabled, onError }: { node: NetNode; channel: number; iface: Iface | undefined; disabled: boolean; onError: (reason: string | null) => void }) {
  const setPo = useGameStore((s) => s.setPo);
  const [ip, setIp] = useState('');
  const [prefix, setPrefix] = useState('24');
  const addable = isIpText(ip) && /^\d+$/.test(prefix) && Number(prefix) >= 8 && Number(prefix) <= 30;
  if (iface) {
    return (
      <div style={row}>
        <b>{iface.id}</b>
        <span>{iface.ip}/{iface.prefix}</span>
        <Button variant="secondary" size="fit" disabled={disabled} onClick={() => onError(setPo(node.uid, channel, '', iface.prefix))}>
          {t('ui.config.vrrpRemove')}
        </Button>
      </div>
    );
  }
  return (
    <div style={row}>
      <b>{`Po${channel}`}</b>
      <TextInput label="IP" placeholder="IP" value={ip} disabled={disabled} onChange={setIp} layout={{ width: 120 }} />
      <TextInput label={t('ui.config.prefix')} value={prefix} disabled={disabled} onChange={setPrefix} layout={{ width: 40 }} />
      <Button
        variant="secondary"
        size="fit"
        disabled={disabled || !addable}
        onClick={() => {
          const reason = setPo(node.uid, channel, ip, Number(prefix));
          onError(reason);
          if (reason === null) setIp('');
        }}
      >
        {t('ui.config.poAdd')}
      </Button>
    </div>
  );
}
