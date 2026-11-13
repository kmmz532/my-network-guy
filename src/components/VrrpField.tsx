// インターフェースの VRRP の欄（NET.md §5.12）。グループごとに、状態の札（マスター・バックアップ・停止）・仮想 IP アドレス・優先度・プリエンプトを出す。
// 追跡（track）はターミナルから設定する
import { useState } from 'react';
import { t } from '../i18n/t';
import { gameEnv } from '../sim/env';
import { vrrpStatusOf } from '../network/netState';
import type { Iface, NetNode, Network } from '../network/types';
import { useGameStore } from '../stores/useGameStore';
import { buttonStyle, greyColor, inputStyle, isIpText } from './devicePorts';

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

// 状態の札の色（マスター: 緑・バックアップ: 灰・停止: 橙）
const BADGE = { Master: '#62d26f', Backup: '#8a8f98', Init: '#f0a030' } as const;

interface Props {
  node: NetNode;
  iface: Iface;
  net: Network;
  disabled: boolean;
  onError: (reason: string | null) => void;
}

export function VrrpField({ node, iface, net, disabled, onError }: Props) {
  const setVrrp = useGameStore((s) => s.setVrrp);
  const [vrid, setVrid] = useState('');
  const [ip, setIp] = useState('');
  // 追跡の追加（追跡する口と、止まったときに下げる値）
  const [trackIface, setTrackIface] = useState('');
  const [decrement, setDecrement] = useState('10');
  const others = node.interfaces.filter((i) => i.id !== iface.id);
  const status = vrrpStatusOf(net, gameEnv.engine, node.uid).filter((s) => s.iface === iface.id);
  const groups = iface.vrrp ?? [];
  const addable = /^\d+$/.test(vrid) && isIpText(ip);
  return (
    <div style={{ margin: '4px 0' }}>
      <div style={{ color: greyColor, fontSize: 12 }}>{t('ui.config.vrrp')}</div>
      {groups.map((g) => {
        const s = status.find((x) => x.vrid === g.vrid);
        return (
          <div key={g.vrid} style={{ ...row, fontSize: 12 }}>
            <b>{t('ui.config.vrrpGroup', { vrid: g.vrid })}</b>
            {s && <span style={{ background: BADGE[s.state], color: '#2a2f36', padding: '0 6px' }}>{t(`ui.config.vrrpState.${s.state}`)}</span>}
            <span>{t('ui.config.vrrpVip')}: {g.ip}</span>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {t('ui.config.vrrpPriority')}
              <input
                type="number"
                min={1}
                max={254}
                defaultValue={g.priority}
                key={`${iface.id}-${g.vrid}-${g.priority}`}
                disabled={disabled}
                style={{ ...inputStyle, width: 56 }}
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isInteger(v) || v === g.priority) return;
                  onError(setVrrp(node.uid, { op: 'priority', id: iface.id, vrid: g.vrid, value: v }));
                }}
              />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                checked={g.preempt}
                disabled={disabled}
                onChange={(e) => onError(setVrrp(node.uid, { op: 'preempt', id: iface.id, vrid: g.vrid, on: e.target.checked }))}
              />
              {t('ui.config.vrrpPreempt')}
            </label>
            <button style={buttonStyle} disabled={disabled} onClick={() => onError(setVrrp(node.uid, { op: 'remove', id: iface.id, vrid: g.vrid }))}>
              {t('ui.config.vrrpRemove')}
            </button>
            {(g.track ?? []).map((tr) => (
              <span key={tr.iface} style={{ color: greyColor }}>{t('ui.config.vrrpTrackLine', { iface: tr.iface, decrement: tr.decrement })}</span>
            ))}
            {others.length > 0 && (
              <>
                <select aria-label={t('ui.config.vrrpTrackIface')} value={trackIface} disabled={disabled} onChange={(e) => setTrackIface(e.target.value)}>
                  <option value="">{t('ui.config.vrrpTrack')}</option>
                  {others.map((o) => (
                    <option key={o.id} value={o.id}>{o.id}</option>
                  ))}
                </select>
                <input aria-label={t('ui.config.vrrpTrackDecrement')} type="number" min={1} max={253} value={decrement} disabled={disabled} style={{ ...inputStyle, width: 56 }} onChange={(e) => setDecrement(e.target.value)} />
                <button
                  style={buttonStyle}
                  disabled={disabled || trackIface === '' || !/^\d+$/.test(decrement)}
                  onClick={() => onError(setVrrp(node.uid, { op: 'track', id: iface.id, vrid: g.vrid, iface: trackIface, decrement: Number(decrement) }))}
                >
                  {t('ui.config.vrrpTrackAdd')}
                </button>
              </>
            )}
          </div>
        );
      })}
      <div style={row}>
        <input aria-label={t('ui.config.vrrpVrid')} placeholder={t('ui.config.vrrpVrid')} value={vrid} disabled={disabled} style={{ ...inputStyle, width: 56 }} onChange={(e) => setVrid(e.target.value)} />
        <input aria-label={t('ui.config.vrrpVip')} placeholder={t('ui.config.vrrpVip')} value={ip} disabled={disabled} style={{ ...inputStyle, width: 120 }} onChange={(e) => setIp(e.target.value)} />
        <button
          style={buttonStyle}
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
        </button>
      </div>
    </div>
  );
}
