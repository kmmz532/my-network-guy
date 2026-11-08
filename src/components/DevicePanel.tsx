// 機器の画面の中身。ウィンドウ（Window.tsx）の中に出し、タイトルの帯・×・大きさは Windows.tsx が受け持つ。
// 背面・設定・サービス（サーバーだけ）・ターミナルのタブを持つ。閉じるのは、ウィンドウの×か Esc（キーは input/keymap.ts が受け取る）。
import { nodeLabel } from './nodeLabel';
import { duplicateHostnames } from '../sim/project';
import { useState } from 'react';
import { devices as deviceData } from 'virtual:game-data';
import { t, tDyn } from '../i18n/t';
import { compile, type Compiled } from '../network/compile';
import type { NetLink, NetNode, Network } from '../network/types';
import { seenSourcesOf } from '../network/netState';
import { engineWithWalls } from '../sim/walls';
import { gameEnv } from '../sim/env';
import { focusedProject, useGameStore, type GameState } from '../stores/useGameStore';
import { RearTab as DeviceRear } from './DeviceRear';
import { DeviceSettings } from './DeviceSettings';
import { TrimmedIcon } from './Icon';
import { TerminalTab } from './TerminalTab';
import { Tabs, TAB_COLORS, tabPanelStyle } from './Tabs';
import { buttonStyle, greyColor, warnColor } from './devicePorts';
import { CATEGORY } from '../data/categories';

type Tab = 'rear' | 'config' | 'service' | 'terminal';

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
  // 絵と名前は1行に収める。長い名前は省略する（タブの高さをショップのタブと同じにするため、絵は文字の高さに収まる大きさにする）
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, minWidth: 0, maxWidth: '100%', whiteSpace: 'nowrap' }}>
      {device && <TrimmedIcon name={device.sprite} height={16} />}
      <b style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{nodeLabel(state, found.node, found.source.nodes)}</b>
    </span>
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
  const isServer = info?.category === CATEGORY.server;
  // 設定できるもの（IPアドレスなど）がない機器（L2 スイッチ）は、設定タブを出さない
  const hasConfig = info?.category !== CATEGORY.l2Switch;
  const issue = compiled.issues[node.uid];

  return (
    <div>
      {issue && <div style={{ color: warnColor, marginBottom: 6 }}>{tDyn(`issue.${issue.reason}`, { ip: issue.ip ?? '', segment: issue.segment ?? '', gateway: issue.gateway ?? '' })}</div>}
      {readOnly && <div style={{ marginBottom: 6 }}>{t('ui.config.readOnly')}</div>}
      <Tabs<Tab>
        items={[
          { id: 'rear', label: t('ui.panel.tab.rear') },
          ...(hasConfig ? [{ id: 'config' as const, label: t('ui.panel.tab.config') }] : []),
          ...(isServer ? [{ id: 'service' as const, label: t('ui.panel.tab.service') }] : []),
          { id: 'terminal', label: t('ui.panel.tab.terminal') },
        ]}
        selected={tab}
        onSelect={(id) => {
          setTab(id);
          setError(null);
        }}
        colors={TAB_COLORS.window}
      />
      <div style={tabPanelStyle(TAB_COLORS.window.selected)}>
        {error && <div style={{ color: warnColor, marginBottom: 6 }}>{tDyn(`ui.error.${error}`)}</div>}
        {tab === 'rear' && <DeviceRear node={node} nodes={nodes} links={links} net={compiled.net} readOnly={readOnly} onError={setError} />}
        {tab === 'config' && hasConfig && (
          <DeviceSettings node={node} compiled={compiled} readOnly={readOnly} detailOpen={detailOpen} onToggleDetail={onToggleDetail} onError={setError} />
        )}
        {tab === 'service' && isServer && <ServiceTab node={node} nodes={nodes} net={compiled.net} readOnly={readOnly} onError={setError} />}
        {tab === 'terminal' && <TerminalTab node={node} nodes={nodes} links={links} readOnly={readOnly} />}
      </div>
    </div>
  );
}

// アクセスしてきたアドレス（N146）: 届いた HTTP の送信元を、サーバーから見たアドレスで出す。NAPT で書き換えた通信は外のアドレス
function SeenSources({ node, nodes, net }: { node: NetNode; nodes: NetNode[]; net: Network }) {
  const store = useGameStore.getState();
  // 画面の判定と同じ電波・壁の計算を使う
  const engine = engineWithWalls(gameEnv.engine, store.maps[focusedProject(store)?.contract.map ?? 'hq']);
  const http = node.services.find((s) => s.protocol === 'http');
  if (!http) return null;
  const clients = nodes.filter((n) => gameEnv.engine.categoryOf(n.device) === CATEGORY.pc).map((n) => n.uid);
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const seen = seenSourcesOf(net, engine, node.uid, http.port, clients);
  return (
    <div style={{ marginTop: 6, fontSize: 13 }}>
      <b>{t('ui.service.seen')}</b>
      {seen.length === 0 && <div style={{ color: greyColor }}>{t('ui.service.seenNone')}</div>}
      {seen.map((s) => {
        const client = byUid.get(s.client);
        return client ? <div key={s.client}>{t('ui.service.seenItem', { name: nodeLabel(store, client, nodes), ip: s.seenIp })}</div> : null;
      })}
    </div>
  );
}

// サービスタブ（サーバーだけ）。HTTP を起動・停止する
function ServiceTab({ node, nodes, net, readOnly, onError }: { node: NetNode; nodes: NetNode[]; net: Network; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setService = useGameStore((s) => s.setService);
  const setDnsRole = useGameStore((s) => s.setDnsRole);
  const autoRegisterZone = useGameStore((s) => s.autoRegisterZone);
  const http = node.services.find((s) => s.protocol === 'http');
  const running = http !== undefined;
  const locked = readOnly || node.configLocked;
  // DNS の表（名前 → IPアドレス）。同じ名前の機器があれば警告する（N68）
  const zone = node.dns?.zone ?? [];
  const duplicates = duplicateHostnames(nodes);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <b>{t('ui.dns.title')}</b>
        <span style={{ color: node.dns ? '#62d26f' : greyColor }}>{node.dns ? t('ui.service.running') : t('ui.service.stopped')}</span>
        <button style={buttonStyle} disabled={locked} onClick={() => onError(setDnsRole(node.uid, !node.dns))}>
          {node.dns ? t('ui.service.stop') : t('ui.service.start')}
        </button>
        {node.dns && (
          <button style={buttonStyle} disabled={locked} onClick={() => onError(autoRegisterZone(node.uid))}>
            {t('ui.dns.register')}
          </button>
        )}
      </div>
      {node.dns && (
        <div style={{ marginTop: 4, fontSize: 13 }}>
          {zone.length === 0 ? <div>{t('ui.dns.empty')}</div> : zone.map((h) => <div key={h.name}>{`${h.name}  ${h.ip}`}</div>)}
          {duplicates.length > 0 && <div style={{ color: '#ffd866' }}>{t('ui.dns.duplicate', { names: duplicates.join('・') })}</div>}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>{t('ui.service.http')}</b>
        <span>{running ? t('ui.service.port', { port: http.port }) : null}</span>
        <span style={{ color: running ? '#62d26f' : greyColor }}>{running ? t('ui.service.running') : t('ui.service.stopped')}</span>
        <button style={buttonStyle} disabled={locked} onClick={() => onError(setService(node.uid, 'http', !running))}>
          {running ? t('ui.service.stop') : t('ui.service.start')}
        </button>
      </div>
      {running && <SeenSources node={node} nodes={nodes} net={net} />}
      {node.configLocked && <div style={{ marginTop: 6 }}>{t('ui.service.locked')}</div>}
    </div>
  );
}
