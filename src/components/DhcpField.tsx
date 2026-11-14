// DHCP の欄（NET.md §5.7）。クライアントの口の自動と手動、ルーターのリレー先、サーバーのプールを出す。
// 設定はターミナルの `ip address <口> dhcp`・`ip helper-address`・`ip dhcp pool` と同じ操作に当てる
import { useState } from 'react';
import { t } from '../i18n/t';
import { can } from '../network/capabilities';
import type { DhcpPool, Iface, NetNode } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { buttonStyle, greyColor, isIpText } from './devicePorts';
import { Checkbox } from './ui/Checkbox';
import { TextInput } from './ui/TextInput';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

// 口ごとの欄: 自動（DHCP）の選択（クライアント）と、リレー先（ルーター・L3スイッチ）
export function DhcpPortField({ node, port, iface, client, disabled, onError }: { node: NetNode; port: number; iface: Iface | undefined; client: boolean; disabled: boolean; onError: (reason: string | null) => void }) {
  const setDhcp = useGameStore((s) => s.setDhcp);
  const setIface = useGameStore((s) => s.setIface);
  if (client) {
    return (
      <div style={row}>
        <Checkbox label={t('ui.config.dhcpAuto')} checked={iface?.dhcp === true} disabled={disabled} onChange={(on) => onError(on ? setDhcp(node.uid, { op: 'client', port }) : iface ? setIface(node.uid, port, iface.ip === '0.0.0.0' ? '' : iface.ip, iface.prefix) : null)}>
          {t('ui.config.dhcpAuto')}
        </Checkbox>
        {iface?.dhcp === true && <span style={{ color: greyColor, fontSize: 12 }}>{t('ui.config.dhcpLease', { ip: iface.ip })}</span>}
      </div>
    );
  }
  if (iface && can(node.device, 'dhcpRelay')) {
    return (
      <div style={row}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          {t('ui.config.dhcpHelper')}
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
      <div style={{ color: greyColor, fontSize: 12 }}>{t('ui.config.dhcpPools')}</div>
      {(node.dhcpPools ?? []).map((p) => (
        <div key={p.network} style={{ ...row, fontSize: 12 }}>
          <span>{text(p)}</span>
          <button style={buttonStyle} disabled={disabled} onClick={() => onError(setDhcp(node.uid, { op: 'noPool', network: p.network }))}>
            {t('ui.config.vrrpRemove')}
          </button>
        </div>
      ))}
      <div style={row}>
        {field('network', 'ui.config.dhcpNetwork', 110)}
        {field('prefix', 'ui.config.prefix', 40)}
        {field('start', 'ui.config.dhcpStart', 110)}
        {field('end', 'ui.config.dhcpEnd', 110)}
        {field('gateway', 'ui.config.dhcpGateway', 110)}
        {field('dns', 'ui.config.dhcpDns', 110)}
        <button
          style={buttonStyle}
          disabled={disabled || !addable}
          onClick={() => {
            const reason = setDhcp(node.uid, { op: 'pool', pool: { network: f.network, prefix: Number(f.prefix), start: f.start, end: f.end, ...(f.gateway ? { gateway: f.gateway } : {}), ...(f.dns ? { dns: f.dns } : {}) } });
            onError(reason);
            if (reason === null) setF({ network: '', prefix: '24', start: '', end: '', gateway: '', dns: '' });
          }}
        >
          {t('ui.config.dhcpPoolAdd')}
        </button>
      </div>
    </div>
  );
}
