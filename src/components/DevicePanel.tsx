// 機器の画面。機器を押すと右側に開き（幅 300 px、マップに重ねる）、背面・設定・サービス（サーバーだけ）・ターミナル（押せない）のタブを持つ。
// 空きマスを押すか Esc で閉じる。別の機器を押すと中身が替わる。
import { useEffect, useState } from 'react';
import { devices as deviceData } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { compile, type Compiled } from '../network/compile';
import type { NetLink, NetNode } from '../network/types';
import { gameEnv } from '../sim/env';
import { focusedProject, useGameStore } from '../stores/useGameStore';
import { RearTab as DeviceRear } from './DeviceRear';
import { DeviceSettings } from './DeviceSettings';
import { Icon } from './Icon';
import { buttonStyle, greyColor, panelStyle, warnColor } from './devicePorts';

type Tab = 'rear' | 'config' | 'service';

export function DevicePanel() {
  const selectedUid = useGameStore((s) => s.selectedUid);
  const state = useGameStore();

  // Esc で閉じる
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useGameStore.getState();
      if (e.key === 'Escape' && s.selectedUid !== null) s.setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!selectedUid) return null;
  const active = focusedProject(state);
  // 表示中の案件（設計中、または納品の結果）の機器を優先し、なければ自社オフィスの機器
  const project = active ?? state.showcase;
  const inProject = project?.nodes.find((n) => n.uid === selectedUid);
  if (!inProject && active) return null;
  const source = inProject && project
    ? { nodes: project.nodes, links: project.links, segments: project.segments }
    : { nodes: state.office.nodes, links: state.office.links, segments: state.office.segments };
  const node = source.nodes.find((n) => n.uid === selectedUid);
  if (!node) return null;
  // 案件を表示しているときは設計中だけ変更できる。自社オフィスは、納品の結果を表示していなければ変更できる
  const readOnly = active ? active.phase !== 'design' : state.showcase !== null;
  const compiled = compile(source, gameEnv.engine);
  return (
    <DeviceView
      key={node.uid}
      node={node}
      nodes={source.nodes}
      links={source.links as NetLink[]}
      compiled={compiled}
      readOnly={readOnly}
    />
  );
}

function DeviceView({
  node,
  nodes,
  links,
  compiled,
  readOnly,
}: {
  node: NetNode;
  nodes: NetNode[];
  links: NetLink[];
  compiled: Compiled;
  readOnly: boolean;
}) {
  const setSelected = useGameStore((s) => s.setSelected);
  const [tab, setTab] = useState<Tab>('rear');
  const [error, setError] = useState<string | null>(null);

  const info = gameEnv.devices[node.device];
  const isServer = info?.category === 'server';
  const device = deviceData[node.device as keyof typeof deviceData];
  const issue = compiled.issues[node.uid];

  const tabButton = (id: Tab, label: string) => (
    <button
      key={id}
      onClick={() => {
        setTab(id);
        setError(null);
      }}
      style={{
        padding: '2px 8px',
        cursor: 'pointer',
        background: tab === id ? warnColor : '#25406f',
        color: tab === id ? '#3b2a33' : '#f4f1e6',
        border: '1px solid #3b2a33',
        borderRadius: 3,
      }}
    >
      {label}
    </button>
  );

  return (
    <section style={panelStyle}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, gap: 6 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          {device && <Icon name={device.sprite} scale={1} />}
          <b>{t(`device.${node.device}.name` as LangKey)}</b>
        </span>
        <button style={buttonStyle} aria-label={t('ui.panel.close')} onClick={() => setSelected(null)}>
          {t('ui.panel.close')}
        </button>
      </div>
      {issue && <div style={{ color: warnColor, marginBottom: 6 }}>{t(`issue.${issue.reason}` as LangKey, { ip: issue.ip ?? '', segment: issue.segment ?? '', gateway: issue.gateway ?? '' })}</div>}
      {readOnly && <div style={{ marginBottom: 6 }}>{t('ui.config.readOnly')}</div>}
      <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginBottom: 8 }}>
        {tabButton('rear', t('ui.panel.tab.rear'))}
        {tabButton('config', t('ui.panel.tab.config'))}
        {isServer && tabButton('service', t('ui.panel.tab.service'))}
        <span aria-disabled="true" style={{ padding: '2px 8px', color: greyColor, opacity: 0.4, border: '1px solid transparent' }}>
          {t('ui.panel.tab.terminal')}
        </span>
      </nav>
      {error && <div style={{ color: warnColor, marginBottom: 6 }}>{t(`ui.error.${error}` as LangKey)}</div>}
      {tab === 'rear' && <DeviceRear node={node} nodes={nodes} links={links} readOnly={readOnly} onError={setError} />}
      {tab === 'config' && <DeviceSettings node={node} compiled={compiled} readOnly={readOnly} onError={setError} />}
      {tab === 'service' && isServer && <ServiceTab node={node} readOnly={readOnly} onError={setError} />}
    </section>
  );
}

// サービスタブ（サーバーだけ）。HTTP を起動・停止する
function ServiceTab({ node, readOnly, onError }: { node: NetNode; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setService = useGameStore((s) => s.setService);
  const http = node.services.find((s) => s.protocol === 'http');
  const running = http !== undefined;
  const locked = readOnly || node.configLocked;
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>{t('ui.service.http')}</b>
        <span>{running ? t('ui.service.port', { port: http.port }) : null}</span>
        <span style={{ color: running ? '#62d26f' : greyColor }}>{running ? t('ui.service.running') : t('ui.service.stopped')}</span>
        <button style={buttonStyle} disabled={locked} onClick={() => onError(setService(node.uid, 'http', !running))}>
          {running ? t('ui.service.stop') : t('ui.service.start')}
        </button>
      </div>
      {node.configLocked && <div style={{ marginTop: 6 }}>{t('ui.service.locked')}</div>}
    </div>
  );
}
