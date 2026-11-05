// 選んだ機器の IP アドレス・ゲートウェイ・静的ルートを設定する。機器をクリックすると右上に開く。設計中の案件、または自社オフィス（納品の結果を表示していないとき）で変更できる。
// 候補からの選択は P3 で作る。今は直接入力だけを置く
import { useState } from 'react';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { compile, type IssueDetail } from '../network/compile';
import type { NetNode } from '../network/types';
import { gameEnv } from '../sim/env';
import { designIssues } from '../sim/project';
import { focusedProject, useGameStore } from '../stores/useGameStore';

const inputStyle = { width: 140, marginRight: 4 } as const;

export function ConfigPanel() {
  const active = useGameStore(focusedProject);
  const office = useGameStore((s) => s.office);
  const selectedUid = useGameStore((s) => s.selectedUid);
  const showcase = useGameStore((s) => s.showcase);
  const setSelected = useGameStore((s) => s.setSelected);
  if (!selectedUid) return null;

  // 設計中の案件の機器、または自社オフィスの機器
  const node = active?.nodes.find((n) => n.uid === selectedUid) ?? office.nodes.find((n) => n.uid === selectedUid);
  if (!node) return null;
  // 案件を表示しているときは設計中だけ変更できる。自社オフィスは、納品の結果を表示していなければ変更できる
  const readOnly = active ? active.phase !== 'design' : showcase !== null;
  // この機器の不備（案件の機器なら設計中の案件、自社オフィスの機器なら自社オフィスから求める）
  const issues = active?.nodes.some((n) => n.uid === node.uid)
    ? designIssues(active, gameEnv)
    : compile({ nodes: office.nodes, links: office.links, segments: office.segments }, gameEnv.engine).issues;
  const issue = issues[node.uid];

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
      <NodeConfig key={node.uid} node={node} readOnly={readOnly} issue={issue} />
    </section>
  );
}

function NodeConfig({ node, readOnly, issue }: { node: NetNode; readOnly: boolean; issue: IssueDetail | undefined }) {
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
      {issue && (
        <div style={{ color: '#ffd866', marginBottom: 6 }}>
          {t(`issue.${issue.reason}` as LangKey, { ip: issue.ip ?? '', segment: issue.segment ?? '', gateway: issue.gateway ?? '' })}
        </div>
      )}
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
      <input style={inputStyle} value={text} disabled={disabled} onChange={(e) => setText(e.target.value)} />
      {value === '' && <span style={{ color: '#ff6b6b', marginRight: 4 }}>{t('ui.ip.unset')}</span>}
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
      <input style={inputStyle} value={dest} onChange={(e) => setDest(e.target.value)} />
      <div>{t('ui.config.routeNext')}</div>
      <input style={inputStyle} value={next} onChange={(e) => setNext(e.target.value)} />
      <button style={{ cursor: 'pointer' }} onClick={() => onAdd(dest.trim(), next.trim())}>
        {t('ui.config.addRoute')}
      </button>
    </div>
  );
}
