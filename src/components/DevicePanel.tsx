// 機器の画面の中身。ウィンドウ（Window.tsx）の中に出し、タイトルの帯・×・大きさは Windows.tsx が受け持つ。
// 背面・設定・サービス（サーバーだけ）・ターミナル（押せない）のタブを持つ。閉じるのは、ウィンドウの×か Esc（キーは input/keymap.ts が受け取る）。
import { useState } from 'react';
import { devices as deviceData } from 'virtual:game-data';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { compile, type Compiled } from '../network/compile';
import type { NetLink, NetNode } from '../network/types';
import { gameEnv } from '../sim/env';
import { focusedProject, useGameStore, type GameState } from '../stores/useGameStore';
import { RearTab as DeviceRear } from './DeviceRear';
import { DeviceSettings } from './DeviceSettings';
import { Icon } from './Icon';
import { Tabs, TAB_COLORS, tabPanelStyle } from './Tabs';
import { buttonStyle, greyColor, warnColor } from './devicePorts';

type Tab = 'rear' | 'config' | 'service';
// タブの並び（ターミナルは押せない表示だけのタブ）
type TabId = Tab | 'terminal';

// uid の機器を探す。表示中の案件（設計中、または納品の結果）を優先し、なければ自社オフィス。見つからなければ null
export function findDevice(state: GameState, uid: string) {
  const active = focusedProject(state);
  const project = active ?? state.showcase;
  const inProject = project?.nodes.find((n) => n.uid === uid);
  if (!inProject && active) return null;
  const source = inProject && project
    ? { nodes: project.nodes, links: project.links, segments: project.segments }
    : { nodes: state.office.nodes, links: state.office.links, segments: state.office.segments };
  const node = source.nodes.find((n) => n.uid === uid);
  if (!node) return null;
  // 案件を表示しているときは設計中だけ変更できる。自社オフィスは、納品の結果を表示していなければ変更できる
  const readOnly = active ? active.phase !== 'design' : state.showcase !== null;
  return { node, source, readOnly };
}

// ウィンドウのタイトル（機器の絵と名前）
export function DeviceTitle({ uid }: { uid: string }) {
  const state = useGameStore();
  const found = findDevice(state, uid);
  if (!found) return null;
  const device = deviceData[found.node.device as keyof typeof deviceData];
  return (
    <>
      {device && <Icon name={device.sprite} scale={1} />}
      <b>{t(`device.${found.node.device}.name` as LangKey)}</b>
    </>
  );
}

// ウィンドウの中身（機器の画面）。機器が見つからなければ何も出さない
export function DeviceBody({ uid }: { uid: string }) {
  const state = useGameStore();
  // 設定タブの「詳しく」を開いているか。機器の画面を閉じるまで覚える（別の機器を押しても変えない）
  const [detailOpen, setDetailOpen] = useState(false);
  const found = findDevice(state, uid);
  if (!found) return null;
  const compiled = compile(found.source, gameEnv.engine);
  return (
    <DeviceView
      key={found.node.uid}
      node={found.node}
      nodes={found.source.nodes}
      links={found.source.links as NetLink[]}
      compiled={compiled}
      readOnly={found.readOnly}
      detailOpen={detailOpen}
      onToggleDetail={() => setDetailOpen((v) => !v)}
    />
  );
}

function DeviceView({
  node,
  nodes,
  links,
  compiled,
  readOnly,
  detailOpen,
  onToggleDetail,
}: {
  node: NetNode;
  nodes: NetNode[];
  links: NetLink[];
  compiled: Compiled;
  readOnly: boolean;
  detailOpen: boolean;
  onToggleDetail: () => void;
}) {
  const [tab, setTab] = useState<Tab>('rear');
  const [error, setError] = useState<string | null>(null);

  const info = gameEnv.devices[node.device];
  const isServer = info?.category === 'server';
  const issue = compiled.issues[node.uid];

  return (
    <div>
      {issue && <div style={{ color: warnColor, marginBottom: 6 }}>{t(`issue.${issue.reason}` as LangKey, { ip: issue.ip ?? '', segment: issue.segment ?? '', gateway: issue.gateway ?? '' })}</div>}
      {readOnly && <div style={{ marginBottom: 6 }}>{t('ui.config.readOnly')}</div>}
      <Tabs<TabId>
        items={[
          { id: 'rear', label: t('ui.panel.tab.rear') },
          { id: 'config', label: t('ui.panel.tab.config') },
          ...(isServer ? [{ id: 'service' as const, label: t('ui.panel.tab.service') }] : []),
          { id: 'terminal', label: t('ui.panel.tab.terminal'), disabled: true },
        ]}
        selected={tab}
        onSelect={(id) => {
          // ターミナルは押せない（表示だけ）
          if (id === 'terminal') return;
          setTab(id);
          setError(null);
        }}
        colors={TAB_COLORS.window}
      />
      <div style={tabPanelStyle(TAB_COLORS.window.selected)}>
        {error && <div style={{ color: warnColor, marginBottom: 6 }}>{t(`ui.error.${error}` as LangKey)}</div>}
        {tab === 'rear' && <DeviceRear node={node} nodes={nodes} links={links} readOnly={readOnly} onError={setError} />}
        {tab === 'config' && (
          <DeviceSettings node={node} compiled={compiled} readOnly={readOnly} detailOpen={detailOpen} onToggleDetail={onToggleDetail} onError={setError} />
        )}
        {tab === 'service' && isServer && <ServiceTab node={node} readOnly={readOnly} onError={setError} />}
      </div>
    </div>
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
