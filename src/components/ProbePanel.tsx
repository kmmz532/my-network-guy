import { useState } from 'react';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { gameEnv } from '../sim/env';
import { useGameStore } from '../stores/useGameStore';
import type { Failure, NetNode } from '../network/types';
import { panelStyle } from './panelStyle';


// 機器を「名前（ID）」の形で表す。同じ機材が複数あるとき、IDで区別する
const labelOf = (nodes: NetNode[], uid: string): string => {
  const node = nodes.find((n) => n.uid === uid);
  if (!node) return uid;
  return `${t(`device.${node.device}.name` as LangKey)}（${uid}）`;
};

const failureText = (failure: Failure, nodes: NetNode[]): string => {
  const head = t(`error.${failure.reason}` as LangKey);
  const where = t('ui.probe.at', { node: labelOf(nodes, failure.node) });
  if (failure.reason === 'return.failed' && failure.cause) {
    return `${head} ${where}（${t(`error.${failure.cause.reason}` as LangKey)}）`;
  }
  return `${head} ${where}`;
};

// 送信元と宛先を選んで Ping / HTTP を試し、経路と失敗理由を表示する
export function ProbePanel() {
  const active = useGameStore((s) => s.active);
  const trace = useGameStore((s) => s.lastTrace);
  const probe = useGameStore((s) => s.probe);
  const [kind, setKind] = useState<'ping' | 'http'>('ping');
  const [src, setSrc] = useState('');
  const [dst, setDst] = useState('');
  const [port, setPort] = useState(80);

  if (!active) return null;
  const hosts = active.nodes.filter((n) => {
    const category = gameEnv.devices[n.device]?.category;
    return category === 'pc' || category === 'server';
  });

  return (
    <section style={panelStyle}>
      <h2 style={{ fontSize: 14, margin: '0 0 6px' }}>{t('ui.probe.title')}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label>
          {t('ui.probe.from')}{' '}
          <select value={src} onChange={(e) => setSrc(e.target.value)}>
            <option value="">-</option>
            {hosts.map((n) => (
              <option key={n.uid} value={n.uid}>
                {labelOf(active.nodes, n.uid)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('ui.probe.to')}{' '}
          <select value={dst} onChange={(e) => setDst(e.target.value)}>
            <option value="">-</option>
            {hosts.map((n) => (
              <option key={n.uid} value={n.uid}>
                {labelOf(active.nodes, n.uid)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t('ui.probe.kind')}{' '}
          <select value={kind} onChange={(e) => setKind(e.target.value as 'ping' | 'http')}>
            <option value="ping">{t('ui.probe.kind.ping')}</option>
            <option value="http">{t('ui.probe.kind.http')}</option>
          </select>
        </label>
        {kind === 'http' && (
          <label>
            {t('ui.probe.port')}{' '}
            <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value))} style={{ width: 80 }} />
          </label>
        )}
        <button disabled={!src || !dst || src === dst} onClick={() => probe(kind, src, dst, port)}>
          {t('ui.probe.run')}
        </button>
      </div>
      {trace && (
        <div style={{ marginTop: 10 }}>
          {trace.result.ok ? (
            <div>
              {t('ui.probe.ok')}：{t('ui.probe.path', { path: trace.result.path.map((u) => labelOf(active.nodes, u)).join(' → ') })}
            </div>
          ) : (
            <div style={{ color: '#ffd866' }}>
              {t('ui.probe.failed')}：{trace.result.failure ? failureText(trace.result.failure, active.nodes) : ''}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
