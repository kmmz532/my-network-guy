// DHCP の欄（NET.md §5.7）。クライアントの口の自動と手動、ルーターのリレー先、サーバーのプールを出す。
// 設定はターミナルの `ip address <口> dhcp`・`ip helper-address`・`ip dhcp pool` と同じ操作に当てる
import { useState } from 'react';
import { t } from '../i18n/t';
import { can } from '../network/capabilities';
import { getComponent } from '../network/components';
import type { DhcpPool, Iface, NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { isIpText } from './devicePorts';
import { sequenceRefOf } from './SequencePanel';
import { Button } from './ui/Button';
import { Checkbox } from './ui/Checkbox';
import { Text } from './ui/Text';
import { TextInput } from './ui/TextInput';
import { Select } from './ui/Select';
import { macOf } from '../network/mac';
import { deviceCategory } from '../registry/query';
import { isL2Category } from '../network/category';
import { netOfDevice } from '../stores/useGameStore';
import { nodeLabel } from './nodeLabel';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

// 口ごとの欄: 自動（DHCP）の選択（クライアント）と、リレー先（ルーター・L3スイッチ）
export function DhcpPortField({ node, port, iface, client, disabled, onError }: { node: NetNode; port: number; iface: Iface | undefined; client: boolean; disabled: boolean; onError: (reason: string | null) => void }) {
  const setDhcp = useGameStore((s) => s.setDhcp);
  const setIface = useGameStore((s) => s.setIface);
  const openWindow = useGameStore((s) => s.openWindow);
  if (client) {
    return (
      <div style={row}>
        <Checkbox label={t('ui.config.dhcpAuto')} checked={iface?.dhcp === true} disabled={disabled} onChange={(on) => onError(on ? setDhcp(node.uid, { op: 'client', port }) : iface ? setIface(node.uid, port, iface.ip === '0.0.0.0' ? '' : iface.ip, iface.prefix) : null)}>
          {t('ui.config.dhcpAuto')}
        </Checkbox>
        {iface?.dhcp === true && <Text as="span" tone="note" size="s">{t('ui.config.dhcpLease', { ip: iface.ip })}</Text>}
        {iface?.dhcp === true && (
          <Button variant="secondary" size="s" onClick={() => openWindow('sequence', sequenceRefOf({ kind: 'dhcp', client: node.uid }))}>
            {t('ui.sequence.open')}
          </Button>
        )}
      </div>
    );
  }
  if (iface && can(node.device, 'dhcpRelay')) {
    return (
      <div style={row}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <Text as="span" size="s">{t('ui.config.dhcpHelper')}</Text>
          <TextInput
            value={iface.helper ?? ''}
            disabled={disabled}
            layout={{ width: 120 }}
            onCommit={(text) => {
              const v = text.trim();
              if (v === (iface.helper ?? '') || (v !== '' && !isIpText(v))) return;
              onError(setDhcp(node.uid, { op: 'helper', port, ip: v === '' ? null : v }));
            }}
          />
        </label>
      </div>
    );
  }
  return null;
}

// サーバーのプール（ネットワーク・マスク長・先頭・末尾・ゲートウェイ・DNS）
export function DhcpPoolField({ node, disabled, onError }: { node: NetNode; disabled: boolean; onError: (reason: string | null) => void }) {
  const setDhcp = useGameStore((s) => s.setDhcp);
  const [f, setF] = useState({ network: '', prefix: '24', start: '', end: '', gateway: '', dns: '' });
  const field = (key: keyof typeof f, label: string, width: number) => (
    <TextInput label={t(label as never)} placeholder={t(label as never)} value={f[key]} disabled={disabled} onChange={(v) => setF({ ...f, [key]: v })} layout={{ width }} />
  );
  const addable = isIpText(f.network) && /^\d+$/.test(f.prefix) && isIpText(f.start) && isIpText(f.end) && (f.gateway === '' || isIpText(f.gateway)) && (f.dns === '' || isIpText(f.dns));
  const text = (p: DhcpPool) => t('ui.config.dhcpPoolLine', { network: p.network, prefix: p.prefix, start: p.start, end: p.end, gateway: p.gateway ?? '-', dns: p.dns ?? '-' });
  return (
    <div style={{ margin: '8px 0' }}>
      <Text tone="note" size="s">{t('ui.config.dhcpPools')}</Text>
      {(getComponent(node, 'dhcpServer') ?? []).map((p) => (
        <div key={p.network} style={row}>
          <Text as="span" size="s">{text(p)}</Text>
          <Button variant="secondary" size="fit" disabled={disabled} onClick={() => onError(setDhcp(node.uid, { op: 'noPool', network: p.network }))}>
            {t('ui.config.vrrpRemove')}
          </Button>
          {(p.reservations ?? []).map((r) => (
            <div key={r.ip} style={{ ...row, width: '100%', paddingLeft: 12 }}>
              <Text as="span" size="s">{t('ui.config.dhcpReservationLine', { ip: r.ip, mac: r.mac })}</Text>
              <Button variant="secondary" size="fit" disabled={disabled} onClick={() => onError(setDhcp(node.uid, { op: 'unreserve', ip: r.ip }))}>
                {t('ui.config.vrrpRemove')}
              </Button>
            </div>
          ))}
        </div>
      ))}
      {(getComponent(node, 'dhcpServer') ?? []).length > 0 && <DhcpReservationRow node={node} disabled={disabled} onError={onError} />}
      <div style={row}>
        {field('network', 'ui.config.dhcpNetwork', 110)}
        {field('prefix', 'ui.config.prefix', 40)}
        {field('start', 'ui.config.dhcpStart', 110)}
        {field('end', 'ui.config.dhcpEnd', 110)}
        {field('gateway', 'ui.config.dhcpGateway', 110)}
        {field('dns', 'ui.config.dhcpDns', 110)}
        <Button
          variant="secondary"
          size="fit"
          disabled={disabled || !addable}
          onClick={() => {
            const reason = setDhcp(node.uid, { op: 'pool', pool: { network: f.network, prefix: Number(f.prefix), start: f.start, end: f.end, ...(f.gateway ? { gateway: f.gateway } : {}), ...(f.dns ? { dns: f.dns } : {}) } });
            onError(reason);
            if (reason === null) setF({ network: '', prefix: '24', start: '', end: '', gateway: '', dns: '' });
          }}
        >
          {t('ui.config.dhcpPoolAdd')}
        </Button>
      </div>
    </div>
  );
}

// 予約の追加の行（N153）。機器を選ぶと MAC アドレスが入る。ほかの MAC アドレスは入力する
function DhcpReservationRow({ node, disabled, onError }: { node: NetNode; disabled: boolean; onError: (reason: string | null) => void }) {
  const setDhcp = useGameStore((s) => s.setDhcp);
  const nodes = useGameStore((s) => netOfDevice(s, node.uid).input.nodes);
  const [mac, setMac] = useState('');
  const [ip, setIp] = useState('');
  // 候補: スイッチを除く、ほかの機器の口0の MAC アドレス
  const candidates = nodes
    .filter((n) => n.uid !== node.uid && n.macSerial !== undefined && !isL2Category(deviceCategory(n.device)))
    .map((n) => ({ value: macOf(deviceCategory(n.device), n.macSerial as number, 0), label: nodeLabel(useGameStore.getState(), n, nodes) }));
  return (
    <div style={row}>
      <Text as="span" size="s">{t('ui.config.dhcpReservation')}</Text>
      <Select label={t('ui.config.dhcpReservationDevice')} value={candidates.some((c) => c.value === mac) ? mac : ''} disabled={disabled} options={[{ value: '', label: '-' }, ...candidates]} onChange={setMac} />
      <TextInput label="MAC" placeholder="xx:xx:xx:xx:xx:xx" value={mac} disabled={disabled} onChange={setMac} layout={{ width: 140 }} />
      <TextInput label={t('ui.config.ip')} placeholder={t('ui.config.ip')} value={ip} disabled={disabled} onChange={setIp} layout={{ width: 110 }} />
      <Button
        variant="secondary"
        size="fit"
        disabled={disabled || mac === '' || !isIpText(ip)}
        onClick={() => {
          const reason = setDhcp(node.uid, { op: 'reserve', ip, mac });
          onError(reason);
          if (reason === null) {
            setMac('');
            setIp('');
          }
        }}
      >
        {t('ui.config.dhcpReservationAdd')}
      </Button>
    </div>
  );
}
