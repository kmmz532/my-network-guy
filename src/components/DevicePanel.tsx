// 機器の画面の中身。ウィンドウ（Window.tsx）の中に出し、タイトルの帯・×・大きさは Windows.tsx が受け持つ。
// 背面・設定・サービス（サーバーだけ）・ターミナルのタブを持つ。閉じるのは、ウィンドウの×か Esc（キーは input/keymap.ts が受け取る）。
import { nodeLabel } from './nodeLabel';
import { duplicateHostnames } from '../sim/project';
import { useState } from 'react';
import { t, tDyn } from '../i18n/t';
import type { DnsRecordType, DnsService, NetLink, NetNode } from '../network/types';
import { isL2Category, seenSourcesOf, type NetworkState } from '../network/public';
import { focusedProject, netOfDevice, useGameStore, type GameState } from '../stores/useGameStore';
import { RearTab as DeviceRear } from './DeviceRear';
import { DeviceSettings } from './DeviceSettings';
import { TrimmedIcon } from './Icon';
import { TerminalTab } from './TerminalTab';
import { Tabs, TabPanel } from './Tabs';
import { isIpText } from './devicePorts';
import { Select } from './ui/Select';
import { TextInput } from './ui/TextInput';
import { Button } from './ui/Button';
import { Text } from './ui/Text';
import { CATEGORY, isPcCategory } from '../data/categories';
import { deviceCategory, deviceDef } from '../registry/query';

type Tab = 'rear' | 'config' | 'service' | 'terminal';
// 機器ごとの、最後に開いた欄。窓を開き直したり機器を押し直したりしても、その欄から開く（初めての機器は背面）
const lastTab = new Map<string, Tab>();

// uid の機器を探す。表示中の案件（設計中、または納品の結果）を優先し、なければ自社オフィス。見つからなければ null
export function findDevice(state: GameState, uid: string) {
  const active = focusedProject(state);
  const project = active ?? state.showcase;
  const inProject = project?.nodes.find((n) => n.uid === uid);
  if (!inProject && active) return null;
  const source = inProject && project
    ? { nodes: project.nodes, links: project.links, plans: project.plans }
    : { nodes: state.office.nodes, links: state.office.links, plans: state.office.plans };
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
  const device = deviceDef(found.node.device);
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
  return (
    <DeviceView
      key={found.node.uid}
      node={found.node}
      nodes={found.source.nodes}
      links={found.source.links as NetLink[]}
      netState={netOfDevice(state, uid)}
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
  netState,
  readOnly,
  detailOpen,
  onToggleDetail,
}: {
  node: NetNode;
  nodes: NetNode[];
  links: NetLink[];
  netState: NetworkState;
  readOnly: boolean;
  detailOpen: boolean;
  onToggleDetail: () => void;
}) {
  const [tab, setTabState] = useState<Tab>(() => lastTab.get(node.uid) ?? 'rear');
  const setTab = (next: Tab) => {
    lastTab.set(node.uid, next);
    setTabState(next);
  };
  const [error, setError] = useState<string | null>(null);
  const duplicateNode = useGameStore((s) => s.duplicateNode);

  const category = deviceCategory(node.device);
  const isServer = category === CATEGORY.server;
  // 設定できるもの（IPアドレスなど）がない機器（L2 スイッチ）は、設定タブを出さない
  const hasConfig = !isL2Category(category);
  const issue = netState.addressing.issues[node.uid];

  return (
    <div>
      {issue && <Text tone="warn" layout={{ marginBottom: 6 }}>{tDyn(`issue.${issue.reason}`, { ip: issue.ip ?? '', segment: issue.segment ?? '', gateway: issue.gateway ?? '' })}</Text>}
      {readOnly && <div style={{ marginBottom: 6 }}>{t('ui.config.readOnly')}</div>}
      {!readOnly && (
        <Button variant="secondary" size="fit" onClick={() => setError(duplicateNode(node.uid))}>
          {t('ui.device.duplicate')}
        </Button>
      )}
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
        tone="window"
      />
      <TabPanel tone="window">
        {error && <Text tone="warn" layout={{ marginBottom: 6 }}>{tDyn(`ui.error.${error}`)}</Text>}
        {tab === 'rear' && <DeviceRear node={node} nodes={nodes} links={links} readOnly={readOnly} onError={setError} />}
        {tab === 'config' && hasConfig && (
          <DeviceSettings node={node} readOnly={readOnly} detailOpen={detailOpen} onToggleDetail={onToggleDetail} onError={setError} />
        )}
        {tab === 'service' && isServer && <ServiceTab node={node} nodes={nodes} state={netState} readOnly={readOnly} onError={setError} />}
        {tab === 'terminal' && <TerminalTab node={node} nodes={nodes} links={links} state={netState} readOnly={readOnly} />}
      </TabPanel>
    </div>
  );
}

// アクセスしてきたアドレス（N146）: 届いた HTTP の送信元を、サーバーから見たアドレスで出す。NAPT で書き換えた通信は外のアドレス
function SeenSources({ node, nodes, state }: { node: NetNode; nodes: NetNode[]; state: NetworkState }) {
  const store = useGameStore.getState();
  const http = node.services.find((s) => s.protocol === 'http');
  if (!http) return null;
  const clients = nodes.filter((n) => isPcCategory(deviceCategory(n.device))).map((n) => n.uid);
  const byUid = new Map(nodes.map((n) => [n.uid, n]));
  const seen = seenSourcesOf(state, node.uid, http.port, clients);
  return (
    <Text size="sm" layout={{ marginTop: 6 }}>
      <b>{t('ui.service.seen')}</b>
      {seen.length === 0 && <Text tone="note" size="sm">{t('ui.service.seenNone')}</Text>}
      {seen.map((s) => {
        const client = byUid.get(s.client);
        return client ? <div key={s.client}>{t('ui.service.seenItem', { name: nodeLabel(store, client, nodes), ip: s.seenIp })}</div> : null;
      })}
    </Text>
  );
}

const DNS_RECORD_TYPES: readonly DnsRecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'NS', 'PTR'];
const dnsRow = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

// DNS のサービスの欄: 役割（権威・キャッシュ）、キャッシュの転送先、ゾーンの記録（種類つき）の一覧と追加・消す
function DnsEditor({ node, dns, locked, onError }: { node: NetNode; dns: DnsService; locked: boolean; onError: (reason: string | null) => void }) {
  const setDnsRole = useGameStore((s) => s.setDnsRole);
  const setDnsForwarder = useGameStore((s) => s.setDnsForwarder);
  const setDnsRecord = useGameStore((s) => s.setDnsRecord);
  const removeDnsRecord = useGameStore((s) => s.removeDnsRecord);
  const [forwarder, setForwarder] = useState(dns.forwarder ?? '');
  const [type, setType] = useState<DnsRecordType>('A');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [pref, setPref] = useState('10');
  const roles: { value: 'auth' | 'cache'; label: string }[] = [
    { value: 'auth', label: t('ui.dns.role.auth') },
    { value: 'cache', label: t('ui.dns.role.cache') },
  ];
  const addValid = name !== '' && value !== '' && (type !== 'MX' || /^\d+$/.test(pref));
  const add = () => onError(setDnsRecord(node.uid, { type, name, value, ...(type === 'MX' ? { pref: Number(pref) } : {}) }));
  return (
    <div style={{ marginTop: 4 }}>
      <div style={dnsRow}>
        <Select box="pixel" label={t('ui.dns.role')} value={dns.role} options={roles} disabled={locked} onChange={(v) => onError(setDnsRole(node.uid, true, v as 'auth' | 'cache'))} />
      </div>
      {dns.role === 'cache' && (
        <div style={dnsRow}>
          <TextInput placeholder={t('ui.dns.forwarder')} value={forwarder} onChange={setForwarder} disabled={locked} layout={{ width: 110 }} />
          <Button variant="secondary" size="s" disabled={locked || (forwarder !== '' && !isIpText(forwarder))} onClick={() => onError(setDnsForwarder(node.uid, forwarder === '' ? null : forwarder))}>
            {t('ui.dns.apply')}
          </Button>
        </div>
      )}
      {dns.zone.length === 0 && <Text size="sm">{t('ui.dns.empty')}</Text>}
      {dns.zone.map((r) => (
        <div key={`${r.type}-${r.name}`} style={dnsRow}>
          <Text as="span" size="sm">{`${r.name}  ${r.type}  ${r.pref === undefined ? r.value : `${r.pref} ${r.value}`}`}</Text>
          <Button variant="secondary" size="s" disabled={locked} onClick={() => onError(removeDnsRecord(node.uid, r.type, r.name))}>
            {t('ui.dns.remove')}
          </Button>
        </div>
      ))}
      <div style={dnsRow}>
        <Select box="pixel" label={t('ui.dns.recordType')} value={type} options={DNS_RECORD_TYPES.map((v) => ({ value: v, label: v }))} disabled={locked} onChange={(v) => setType(v as DnsRecordType)} />
        <TextInput placeholder={t('ui.dns.recordName')} value={name} onChange={setName} disabled={locked} layout={{ width: 120 }} />
        <TextInput placeholder={t('ui.dns.recordValue')} value={value} onChange={setValue} disabled={locked} layout={{ width: 120 }} />
        {type === 'MX' && <TextInput placeholder={t('ui.dns.recordPref')} value={pref} onChange={setPref} disabled={locked} layout={{ width: 40 }} />}
        <Button variant="secondary" size="s" disabled={locked || !addValid} onClick={add}>
          {t('ui.dns.add')}
        </Button>
      </div>
    </div>
  );
}

// サービスタブ（サーバーだけ）。HTTP を起動・停止する
function ServiceTab({ node, nodes, state, readOnly, onError }: { node: NetNode; nodes: NetNode[]; state: NetworkState; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setService = useGameStore((s) => s.setService);
  const setDnsRole = useGameStore((s) => s.setDnsRole);
  const autoRegisterZone = useGameStore((s) => s.autoRegisterZone);
  const http = node.services.find((s) => s.protocol === 'http');
  const running = http !== undefined;
  const locked = readOnly || node.configLocked;
  // DNS のサービス。同じ名前の機器があれば警告する（N68）
  const dns = node.services.find((s): s is DnsService => s.protocol === 'dns');
  const duplicates = duplicateHostnames(nodes);
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
        <b>{t('ui.dns.title')}</b>
        <Text as="span" tone={dns ? 'ok' : 'note'}>{dns ? t('ui.service.running') : t('ui.service.stopped')}</Text>
        <Button variant="secondary" size="fit" disabled={locked} onClick={() => onError(setDnsRole(node.uid, !dns))}>
          {dns ? t('ui.service.stop') : t('ui.service.start')}
        </Button>
        {dns && (
          <Button variant="secondary" size="fit" disabled={locked} onClick={() => onError(autoRegisterZone(node.uid))}>
            {t('ui.dns.register')}
          </Button>
        )}
      </div>
      {dns && <DnsEditor key={node.uid} node={node} dns={dns} locked={locked} onError={onError} />}
      {dns && duplicates.length > 0 && <Text tone="warn" layout={{ marginTop: 4 }}>{t('ui.dns.duplicate', { names: duplicates.join('・') })}</Text>}

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>{t('ui.service.http')}</b>
        <span>{running ? t('ui.service.port', { port: http.port }) : null}</span>
        <Text as="span" tone={running ? 'ok' : 'note'}>{running ? t('ui.service.running') : t('ui.service.stopped')}</Text>
        <Button variant="secondary" size="fit" disabled={locked} onClick={() => onError(setService(node.uid, 'http', !running))}>
          {running ? t('ui.service.stop') : t('ui.service.start')}
        </Button>
      </div>
      {running && <SeenSources node={node} nodes={nodes} state={state} />}
      {node.configLocked && <div style={{ marginTop: 6 }}>{t('ui.service.locked')}</div>}
    </div>
  );
}
