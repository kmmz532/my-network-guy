// 選んだ機器の IP アドレス・ゲートウェイ・静的ルートを設定する。機器をクリックすると右上に開く（設計中のみ変更できる）
import { useState } from 'react';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import type { NetNode } from '../network/types';
import { gameEnv } from '../sim/env';
import { focusedProject, useGameStore } from '../stores/useGameStore';

const inputStyle = { width: 140, marginRight: 4 } as const;

export function ConfigPanel() {
  const active = useGameStore(focusedProject);
  const office = useGameStore((s) => s.office);
  const selectedUid = useGameStore((s) => s.selectedUid);
  const setSelected = useGameStore((s) => s.setSelected);
  if (!selectedUid) return null;

  // 設計中の案件の機器、または自社オフィスの機器
  const node = active?.nodes.find((n) => n.uid === selectedUid) ?? office.nodes.find((n) => n.uid === selectedUid);
  if (!node) return null;
  const readOnly = !active || active.phase !== 'design';

  return (
    <section
      style={{
        position: 'absolute',
        top: 44,
        right: 8,
        width: 260,
        background: 'rgba(47, 79, 143, 0.95)',
        color: '#f4f1e6',
        border: '2px solid #3b2a33',
        borderRadius: 4,
        padding: 8,
        fontSize: 13,
        zIndex: 4,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
        <b>{t(`device.${node.device}.name` as LangKey)}</b>
        <button style={{ cursor: 'pointer' }} onClick={() => setSelected(null)}>
          {t('ui.config.close')}
        </button>
      </div>
      <NodeConfig key={node.uid} node={node} readOnly={readOnly} />
    </section>
  );
}

function NodeConfig({ node, readOnly }: { node: NetNode; readOnly: boolean }) {
  const setIface = useGameStore((s) => s.setIface);
  const setGateway = useGameStore((s) => s.setGateway);
  const addRoute = useGameStore((s) => s.addRoute);
  const removeRoute = useGameStore((s) => s.removeRoute);
  // この機器の設定を変えたときの失敗の理由（パネル内に出す）
  const [error, setError] = useState<string | null>(null);

  const info = gameEnv.devices[node.device];
  const isSwitch = info?.category === 'l2_switch';
  const isRouter = info?.category === 'router';
  const locked = node.configLocked || readOnly;

  return (
    <div>
      {readOnly && <div style={{ marginBottom: 6 }}>{t('ui.config.readOnly')}</div>}
      {!readOnly && node.configLocked && <div style={{ marginBottom: 6 }}>{t('ui.config.locked')}</div>}
      {isSwitch && <div>{t('ui.config.noIp')}</div>}
      {!isSwitch &&
        Array.from({ length: info?.portCount ?? 0 }, (_, port) => (
          <IpField
            key={port}
            label={t('ui.config.port', { port })}
            value={node.interfaces.find((i) => i.port === port)?.ip ?? ''}
            disabled={locked}
            onSave={(ip) => setError(setIface(node.uid, port, ip))}
          />
        ))}
      {!isSwitch && !isRouter && (
        <IpField
          label={t('ui.config.gateway')}
          value={node.gateway ?? ''}
          disabled={locked}
          onSave={(ip) => setError(setGateway(node.uid, ip === '' ? null : ip))}
        />
      )}
      {isRouter && (
        <div style={{ marginTop: 8 }}>
          <div>{t('ui.config.routes')}</div>
          {node.routes.length === 0 && <div>{t('ui.config.noRoute')}</div>}
          {node.routes.map((r, i) => (
            <div key={`${r.dest}-${r.nextHop}-${i}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span>{t('ui.config.routeItem', { dest: r.dest, next: r.nextHop })}</span>
              {!locked && (
                <button style={{ cursor: 'pointer' }} onClick={() => setError(removeRoute(node.uid, i))}>
                  {t('ui.config.remove')}
                </button>
              )}
            </div>
          ))}
          {!locked && (
            <RouteForm onAdd={(dest, nextHop) => setError(addRoute(node.uid, { dest, prefix: 24, nextHop }))} />
          )}
        </div>
      )}
      {error && <div style={{ color: '#ffd866', marginTop: 8 }}>{t(`ui.error.${error}` as LangKey)}</div>}
    </div>
  );
}

// IP アドレスの入力欄。保存は store の操作を通す
function IpField({
  label,
  value,
  disabled,
  onSave,
}: {
  label: string;
  value: string;
  disabled: boolean;
  onSave: (ip: string) => void;
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
      <button style={{ cursor: 'pointer' }} disabled={disabled} onClick={() => onSave(text.trim())}>
        {t('ui.config.set')}
      </button>
    </div>
  );
}

function RouteForm({ onAdd }: { onAdd: (dest: string, nextHop: string) => void }) {
  const [dest, setDest] = useState('');
  const [next, setNext] = useState('');
  return (
    <div style={{ marginTop: 6 }}>
      <div>{t('ui.config.routeDest')}</div>
      <input style={inputStyle} value={dest} onChange={(e) => setDest(e.target.value)} placeholder="192.168.9.0" />
      <div>{t('ui.config.routeNext')}</div>
      <input style={inputStyle} value={next} onChange={(e) => setNext(e.target.value)} placeholder="10.0.0.2" />
      <button style={{ cursor: 'pointer' }} onClick={() => onAdd(dest.trim(), next.trim())}>
        {t('ui.config.addRoute')}
      </button>
    </div>
  );
}
