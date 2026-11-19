// インターフェースの VRRP の欄（NET.md §5.12）。グループごとに、状態の札（マスター・バックアップ・停止）・仮想 IP アドレス・優先度・プリエンプトを出す。
// 追跡（track）はターミナルから設定する
import { useState } from 'react';
import { t } from '../i18n/t';
import { vrrpStatusOf } from '../network/public';
import type { Iface, NetNode } from '../network/types';
import { netOfDevice, useGameStore } from '../stores/useGameStore';
import { isIpText } from './devicePorts';
import { sequenceRefOf } from './SequencePanel';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { Select } from './ui/Select';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

// 状態の札の色（マスター: 緑・バックアップ: 灰・停止: 橙）
const BADGE = { Master: 'var(--st-ok)', Backup: 'var(--st-standby)', Init: 'var(--st-init)' } as const;

interface Props {
  node: NetNode;
  iface: Iface;
  disabled: boolean;
  onError: (reason: string | null) => void;
}

export function VrrpField({ node, iface, disabled, onError }: Props) {
  const setVrrp = useGameStore((s) => s.setVrrp);
  const openWindow = useGameStore((s) => s.openWindow);
  // 画面の計算は、ストアの計算の結果を読む
  const netState = useGameStore((s) => netOfDevice(s, node.uid));
  const [vrid, setVrid] = useState('');
  const [ip, setIp] = useState('');
  // 追跡の追加（追跡する口と、止まったときに下げる値）
  const [trackIface, setTrackIface] = useState('');
  const [decrement, setDecrement] = useState('10');
  const others = node.interfaces.filter((i) => i.id !== iface.id);
  const status = vrrpStatusOf(netState, node.uid).filter((s) => s.iface === iface.id);
  const groups = iface.vrrp ?? [];
  const addable = /^\d+$/.test(vrid) && isIpText(ip);
  return (
    <div style={{ margin: '4px 0' }}>
      <Text tone="note" size="s">{t('ui.config.vrrp')}</Text>
      {groups.map((g) => {
        const s = status.find((x) => x.vrid === g.vrid);
        return (
          <div key={g.vrid} style={row}>
            <Text as="span" size="s" bold>{t('ui.config.vrrpGroup', { vrid: g.vrid })}</Text>
            {s && (
              <Badge color="var(--fg-on-status)" border={BADGE[s.state]} fill={BADGE[s.state]}>
                {t(`ui.config.vrrpState.${s.state}`)}
              </Badge>
            )}
            <Text as="span" size="s">{t('ui.config.vrrpVip')}: {g.ip}</Text>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <Text as="span" size="s">{t('ui.config.vrrpPriority')}</Text>
              <TextInput
                type="number"
                min={1}
                max={254}
                value={String(g.priority)}
                disabled={disabled}
                layout={{ width: 56 }}
                onCommit={(text) => {
                  const v = Number(text);
                  if (!Number.isInteger(v) || v === g.priority) return;
                  onError(setVrrp(node.uid, { op: 'priority', id: iface.id, vrid: g.vrid, value: v }));
                }}
              />
            </label>
            <Checkbox size="s" checked={g.preempt} disabled={disabled} onChange={(on) => onError(setVrrp(node.uid, { op: 'preempt', id: iface.id, vrid: g.vrid, on }))}>
              {t('ui.config.vrrpPreempt')}
            </Checkbox>
            <Button variant="secondary" size="fit" disabled={disabled} onClick={() => onError(setVrrp(node.uid, { op: 'remove', id: iface.id, vrid: g.vrid }))}>
              {t('ui.config.vrrpRemove')}
            </Button>
            <Button variant="secondary" size="fit" onClick={() => openWindow('sequence', sequenceRefOf({ kind: 'vrrp', group: g.vrid }))}>
              {t('ui.sequence.open')}
            </Button>
            {(g.track ?? []).map((tr) => (
              <Text key={tr.iface} as="span" tone="note" size="s">{t('ui.config.vrrpTrackLine', { iface: tr.iface, decrement: tr.decrement })}</Text>
            ))}
            {others.length > 0 && (
              <>
                <Select
                  label={t('ui.config.vrrpTrackIface')}
                  value={trackIface}
                  disabled={disabled}
                  options={[{ value: '', label: t('ui.config.vrrpTrack') }, ...others.map((o) => ({ value: o.id, label: o.id }))]}
                  onChange={(v) => setTrackIface(v)}
                />
                <TextInput label={t('ui.config.vrrpTrackDecrement')} type="number" min={1} max={253} value={decrement} disabled={disabled} onChange={setDecrement} layout={{ width: 56 }} />
                <Button
                  variant="secondary"
                  size="fit"
                  disabled={disabled || trackIface === '' || !/^\d+$/.test(decrement)}
                  onClick={() => onError(setVrrp(node.uid, { op: 'track', id: iface.id, vrid: g.vrid, iface: trackIface, decrement: Number(decrement) }))}
                >
                  {t('ui.config.vrrpTrackAdd')}
                </Button>
              </>
            )}
          </div>
        );
      })}
      <div style={row}>
        <TextInput label={t('ui.config.vrrpVrid')} placeholder={t('ui.config.vrrpVrid')} value={vrid} disabled={disabled} onChange={setVrid} layout={{ width: 56 }} />
        <TextInput label={t('ui.config.vrrpVip')} placeholder={t('ui.config.vrrpVip')} value={ip} disabled={disabled} onChange={setIp} layout={{ width: 120 }} />
        <Button
          variant="secondary"
          size="fit"
          disabled={disabled || !addable}
          onClick={() => {
            const reason = setVrrp(node.uid, { op: 'ip', id: iface.id, vrid: Number(vrid), ip });
            onError(reason);
            if (reason === null) {
              setVrid('');
              setIp('');
            }
          }}
        >
          {t('ui.config.vrrpAdd')}
        </Button>
      </div>
    </div>
  );
}
