import { useState } from 'react';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { gameEnv } from '../sim/env';
import { useGameStore } from '../stores/useGameStore';
import type { NetNode } from '../network/types';

const panelStyle = {
  background: 'rgba(47, 79, 143, 0.9)',
  color: '#f4f1e6',
  padding: 12,
  borderRadius: 4,
  width: 280,
  fontSize: 14,
} as const;

const inputStyle = { width: 140, marginRight: 4 } as const;

// 選んだ機器のIPアドレス・ゲートウェイ・静的ルートを設定する（プレフィックスは /24 に固定）
export function ConfigPanel() {
  const active = useGameStore((s) => s.active);
  const selectedUid = useGameStore((s) => s.selectedUid);
  const node = active?.nodes.find((n) => n.uid === selectedUid);
  const error = useGameStore((s) => s.lastError);

  if (!active) return null;
  return (
    <section style={panelStyle}>
      <h2 style={{ fontSize: 16, margin: '0 0 8px' }}>{t('ui.config.title')}</h2>
      {!node && <div>{t('ui.config.none')}</div>}
      {node && <NodeConfig key={node.uid} node={node} readOnly={active.phase !== 'design'} />}
      {error && <div style={{ color: '#ffd866', marginTop: 8 }}>{t(`ui.error.${error}` as LangKey)}</div>}
    </section>
  );
}

function NodeConfig({ node, readOnly }: { node: NetNode; readOnly: boolean }) {
  const setIface = useGameStore((s) => s.setIface);
  const setGateway = useGameStore((s) => s.setGateway);
  const addRoute = useGameStore((s) => s.addRoute);
  const removeRoute = useGameStore((s) => s.removeRoute);

  const info = gameEnv.devices[node.device];
  const isSwitch = info?.category === 'l2_switch';
  const isRouter = info?.category === 'router';
  const locked = node.configLocked || readOnly;
  const name = t(`device.${node.device}.name` as LangKey);

  return (
    <div>
      <div style={{ marginBottom: 8 }}>{name}</div>
      {locked && <div style={{ marginBottom: 8 }}>{readOnly ? t('ui.config.readOnly') : t('ui.config.locked')}</div>}
      {isSwitch && <div>{t('ui.config.noIp')}</div>}
      {!isSwitch &&
        Array.from({ length: info?.portCount ?? 0 }, (_, port) => (
          <IpField
            key={port}
            label={t('ui.config.port', { port })}
            value={node.interfaces.find((i) => i.port === port)?.ip ?? ''}
            disabled={locked}
            onSave={(ip) => setIface(node.uid, port, ip)}
          />
        ))}
      {!isSwitch && !isRouter && (
        <IpField
          label={t('ui.config.gateway')}
          value={node.gateway ?? ''}
          disabled={locked}
          onSave={(ip) => setGateway(node.uid, ip === '' ? null : ip)}
        />
      )}
      {isRouter && (
        <div style={{ marginTop: 8 }}>
          <div>{t('ui.config.routes')}</div>
          {node.routes.length === 0 && <div>{t('ui.config.noRoute')}</div>}
          {node.routes.map((r, i) => (
            <div key={`${r.dest}-${r.nextHop}-${i}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>{t('ui.config.routeItem', { dest: r.dest, next: r.nextHop })}</span>
              {!locked && <button onClick={() => removeRoute(node.uid, i)}>{t('ui.config.remove')}</button>}
            </div>
          ))}
          {!locked && <RouteForm onAdd={(dest, nextHop) => addRoute(node.uid, { dest, prefix: 24, nextHop })} />}
        </div>
      )}
    </div>
  );
}

// IPアドレスの入力欄。保存は store の操作を通し、失敗の理由は store に残る
function IpField({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onSave: (ip: string) => string | null;
}) {
  const [text, setText] = useState(value);
  return (
    <div style={{ marginBottom: 6 }}>
      <div>{label}</div>
      <input
        style={inputStyle}
        value={text}
        disabled={disabled}
        placeholder="192.168.1.10"
        onChange={(e) => setText(e.target.value)}
      />
      <button disabled={disabled} onClick={() => onSave(text.trim())}>
        {t('ui.config.set')}
      </button>
    </div>
  );
}

function RouteForm({ onAdd }: { onAdd: (dest: string, nextHop: string) => string | null }) {
  const [dest, setDest] = useState('');
  const [next, setNext] = useState('');
  return (
    <div style={{ marginTop: 6 }}>
      <div>{t('ui.config.routeDest')}</div>
      <input style={inputStyle} value={dest} onChange={(e) => setDest(e.target.value)} placeholder="192.168.9.0" />
      <div>{t('ui.config.routeNext')}</div>
      <input style={inputStyle} value={next} onChange={(e) => setNext(e.target.value)} placeholder="10.0.0.2" />
      <button onClick={() => onAdd(dest.trim(), next.trim())}>{t('ui.config.addRoute')}</button>
    </div>
  );
}
