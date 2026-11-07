// 機器の画面の「設定」タブ。ポートごとのIPアドレス（ネットワークは「詳しく」を開いたときだけ出す）、ホストのデフォルトゲートウェイ、ルーターの静的ルートを置く。
// IPアドレスとゲートウェイの欄は、候補から選べる1つの入力欄（AddressInput）にする。確定は候補を選んだとき・Enter・欄を離れたとき。
// PC・サーバーは、ケーブルでつなぐ前でもIPアドレスを設定できる。ルーターのポートはつないでから設定する。
import { nodeLabel } from './nodeLabel';
import { useState } from 'react';
import { t, tDyn } from '../i18n/t';
import { AddressInput } from './AddressInput';
import { PixelSelect } from './PixelControls';
import { primaryButton } from './Modal';
import { dangerButton } from './Modal';
import type { ComboOption } from './comboOptions';
import type { Compiled } from '../network/compile';
import { isRelayPort, isRoutingCategory } from '../network/category';
import { can } from '../network/capabilities';
import { wirelessAssociations, withWireless } from '../network/netState';
import { engineWithWalls } from '../sim/walls';
import { colorOfNetwork, networkColors, UNSET_COLOR } from '../network/netColor';
import { networkAddress, neighborRouterAddresses, routerAddressesOn, segmentConfigOf, segmentOf, segmentsOf } from '../network/segments';
import type { NetNode, Network, SegmentConfig } from '../network/types';
import { gameEnv } from '../sim/env';
import { addressCandidates, PLANNED_NETWORK, PLANNED_PREFIX, plannedAddressCandidates, type AddressCandidate } from '../sim/project';
import { coreOf, focusedProject, netTargetOf, plannedKey, useGameStore } from '../stores/useGameStore';
import { buttonStyle, greyColor, hexColor, inputStyle, isIpText, portLabel, sectionStyle, unsetColor } from './devicePorts';
import { CATEGORY } from '../data/categories';

// ネットワークアドレスの候補（sim-3: 192.168.<n>.0）と、プレフィックス長の候補（/24〜/30）
const NETWORK_CHOICES = Array.from({ length: 16 }, (_, i) => `192.168.${i + 1}.0`);
const PREFIX_CHOICES = [24, 25, 26, 27, 28, 29, 30];

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

interface Props {
  node: NetNode;
  compiled: Compiled;
  readOnly: boolean;
  // 「詳しく」を開いているか。機器の画面を閉じるまで親が覚える
  detailOpen: boolean;
  onToggleDetail: () => void;
  onError: (reason: string | null) => void;
}

export function DeviceSettings({ node, compiled, readOnly, detailOpen, onToggleDetail, onError }: Props) {
  const state = useGameStore();
  const setIface = useGameStore((s) => s.setIface);
  const setGateway = useGameStore((s) => s.setGateway);
  const setSegment = useGameStore((s) => s.setSegment);
  const addRoute = useGameStore((s) => s.addRoute);
  const removeRoute = useGameStore((s) => s.removeRoute);
  const setFirewallRules = useGameStore((s) => s.setFirewallRules);
  // 詳しくで選んだ、まだ設定のないポートのネットワーク（IPアドレスを設定したら消す）。ストアに持ち、配線の自動割り当てで使う
  const planned = useGameStore((s) => s.planned);
  const setPlanned = useGameStore((s) => s.setPlanned);

  const net = compiled.net;
  const engine = gameEnv.engine;
  const category = gameEnv.devices[node.device]?.category;

  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  const colors = networkColors(withWireless(net, engine), engine);
  const locked = readOnly || node.configLocked;
  const portCount = gameEnv.devices[node.device]?.portCount ?? 0;
  // IPアドレスを持つ口（スイッチ付きルーターの2つ目以降の LAN 口は中継だけなので欄を出さない）
  const ports = Array.from({ length: portCount }, (_, p) => p).filter((p) => !isRelayPort(category ?? '', p));

  const linked =(port: number) => net.links.some((l) => (l.a.node === node.uid && l.a.port === port) || (l.b.node === node.uid && l.b.port === port));
  // ポートのセグメントの設定（配線がなければ undefined）
  const cfgOf = (port: number): SegmentConfig | undefined => {
    const seg = segmentOf(segmentsOf(net, engine), node.uid, port);
    return seg ? segmentConfigOf(seg, byUid, net.segments) : undefined;
  };
  // 使用中のアドレスに付ける機器の名前（機器の名前とポートの名前）
  const usedName = (usedBy: { node: string; port: number }): string => {
    const n = byUid.get(usedBy.node);
    if (!n) return '';
    return `${nodeLabel(useGameStore.getState(), n, net.nodes)} ${portLabel(gameEnv.devices[n.device]?.category, usedBy.port)}`;
  };

  // IPアドレスを設定する。設定のないポートは、詳しくで選んだプレフィックス長（なければ /24）で設定する。
  // セグメントの設定は、配線のときと同じく IPアドレスから補う（fillSegments）
  const commitIp = (port: number, ip: string): string | null => {
    const cfg = cfgOf(port);
    const prefix = cfg ? cfg.prefix : (planned[plannedKey(node.uid, port)]?.prefix ?? PLANNED_PREFIX);
    const reason = setIface(node.uid, port, ip, prefix);
    if (!reason) setPlanned(node.uid, port, null);
    return reason;
  };

  const renderPort = (port: number) => {
    const label = portLabel(category, port);
    const heading = ports.length > 1 ? (
      <div>
        <b>{label}</b>
      </div>
    ) : null;
    // ルーターは、ケーブルでつないでから設定する。つなぐ前は欄を薄く出し、操作できないようにする
    const unlinkedRouter = isRoutingCategory(category ?? '') && !linked(port);
    const cfg = cfgOf(port);
    const iface = node.interfaces.find((i) => i.port === port);
    // 今のネットワーク: 設定があればそれ。なければ詳しくで選んだ値、IPアドレスがあればその /24、どちらもなければ既定
    const fromIface = iface ? { network: networkAddress(iface.ip, iface.prefix), prefix: iface.prefix } : null;
    const shown = cfg ?? planned[plannedKey(node.uid, port)] ?? fromIface ?? { network: PLANNED_NETWORK, prefix: PLANNED_PREFIX };
    const color = colorOfNetwork(colors, cfg?.network) ?? UNSET_COLOR;
    // 候補は、読み取り専用でなければ一覧にする。設定の前でも後でも同じ範囲（.1 からブロードキャストの1つ前まで）・同じ順で並べる
    const candidates: AddressCandidate[] = readOnly || unlinkedRouter
      ? []
      : cfg
        ? addressCandidates(coreOf(state), node.uid, port, gameEnv, netTargetOf(state))
        : plannedAddressCandidates(coreOf(state), shown.network, shown.prefix, netTargetOf(state));
    // 使用中の候補は、使っている機器の名前を添えて選べないように出す（自分のポートの使用は選べる）
    const options: ComboOption[] = candidates.map((c) => {
      const other = c.usedBy && !(c.usedBy.node === node.uid && c.usedBy.port === port) ? c.usedBy : null;
      return { value: c.ip, usedBy: other ? usedName(other) : null };
    });
    // 設定のないポートのネットワークを変えるとき、入っているIPアドレスは外す（新しいネットワークのアドレスを選び直す）
    const changePlanned = (next: { network: string; prefix: number }) => {
      setPlanned(node.uid, port, next);
      if (iface) onError(setIface(node.uid, port, ''));
    };
    const networks = cfg && !NETWORK_CHOICES.includes(cfg.network) ? [...NETWORK_CHOICES, cfg.network] : NETWORK_CHOICES;
    return (
      <div key={port} style={unlinkedRouter ? { ...sectionStyle, opacity: 0.45 } : sectionStyle}>
        {heading}
        <div>
          {t('ui.config.ip')}: {iface ? <b>{iface.ip}</b> : <span style={{ color: unsetColor }}>{t('ui.config.unset')}</span>}
        </div>
        <div style={row}>
          <AddressInput
            label={t('ui.config.ip')}
            value={iface?.ip ?? ''}
            options={options}
            disabled={locked || unlinkedRouter}
            isValid={isIpText}
            formatError={t('ui.error.ip')}
            onCommit={(ip) => commitIp(port, ip)}
          />
        </div>
        <div style={{ ...row, fontSize: 12 }}>
          <span style={{ color: greyColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: hexColor(color), border: '1px solid #3b2a33' }} />
            {t('ui.config.networkLine', { network: shown.network, prefix: shown.prefix })}
          </span>
          <button style={buttonStyle} disabled={unlinkedRouter} onClick={onToggleDetail}>
            {detailOpen ? t('ui.config.detailClose') : t('ui.config.detail')}
          </button>
        </div>
        {detailOpen && (
          <div style={row}>
            <PixelSelect<string>
              ariaLabel={t('ui.config.network')}
              value={shown.network}
              disabled={locked || unlinkedRouter}
              options={networks.map((n) => ({ value: n, label: n }))}
              onChange={(v) => {
                // 設定があれば、セグメントのネットワークを変える。なければ、詳しくで選んだ値として覚える
                if (cfg) onError(setSegment(node.uid, port, v, cfg.prefix));
                else changePlanned({ ...shown, network: v });
              }}
            />
            <PixelSelect<number>
              ariaLabel={t('ui.config.prefix')}
              value={shown.prefix}
              disabled={locked || unlinkedRouter}
              options={PREFIX_CHOICES.map((p) => ({ value: p, label: `/${p}` }))}
              onChange={(prefix) => {
                if (cfg) onError(setSegment(node.uid, port, cfg.network, prefix));
                else changePlanned({ ...shown, prefix });
              }}
            />
          </div>
        )}
      </div>
    );
  };

  // ホストのデフォルトゲートウェイ（同じネットワークのルーターのアドレスを候補にする）
  const renderGateway = () => {
    const routers = routerAddressesOn(net, engine, node.uid, 0);
    // 現在のゲートウェイが候補にない場合も、一覧に残す
    const extra = node.gateway && !routers.includes(node.gateway) ? [node.gateway] : [];
    const gatewayOptions: ComboOption[] = [...routers, ...extra].map((ip) => ({ value: ip, usedBy: null }));
    return (
      <div style={sectionStyle}>
        <div>{t('ui.config.gateway')}</div>
        {routers.length === 0 ? (
          <div style={{ color: greyColor }}>{t('ui.config.noRouter')}</div>
        ) : (
          <>
            <div style={row}>
              <AddressInput
                label={t('ui.config.gateway')}
                value={node.gateway ?? ''}
                options={gatewayOptions}
                disabled={locked}
                isValid={isIpText}
                formatError={t('ui.error.ip')}
                allowEmpty
                onCommit={(ip) => setGateway(node.uid, ip || null)}
              />
              {!node.gateway && <span style={{ color: unsetColor }}>{t('ui.config.unset')}</span>}
            </div>
          </>
        )}
      </div>
    );
  };

  // ルーターの静的ルート（宛先・ネクストホップを一覧から選ぶ）
  // ファイアウォールの規則（許可する通信。一覧にない通信は通さない）
  const renderFirewallRules = () => {
    const rules = node.rules ?? [];
    return (
      <div style={sectionStyle}>
        <div>
          <b>{t('ui.fw.rules')}</b>
        </div>
        {rules.length === 0 && <div style={{ color: greyColor }}>{t('ui.fw.none')}</div>}
        {rules.map((r, i) => (
          <div key={`${r.src}-${r.dst}-${r.service}-${r.port ?? ''}-${i}`} style={row}>
            <span>{t('ui.fw.rule', { src: r.src === 'any' ? t('ui.fw.any') : r.src, dst: r.dst === 'any' ? t('ui.fw.any') : r.dst, service: ruleServiceText(r) })}</span>
            {!locked && (
              <button style={dangerButton} onClick={() => onError(setFirewallRules(node.uid, rules.filter((_, j) => j !== i)))}>
                {t('ui.config.remove')}
              </button>
            )}
          </div>
        ))}
        {!locked && <FirewallRuleAdd onAdd={(rule) => onError(setFirewallRules(node.uid, [...rules, rule]))} />}
      </div>
    );
  };

  const renderRoutes = () => {
    const dests = new Map<string, { network: string; prefix: number }>();
    for (const seg of segmentsOf(net, engine)) {
      const cfg = segmentConfigOf(seg, byUid, net.segments);
      if (cfg) dests.set(`${cfg.network}/${cfg.prefix}`, { network: cfg.network, prefix: cfg.prefix });
    }
    const hops = neighborRouterAddresses(net, engine, node.uid);
    return (
      <div style={sectionStyle}>
        <div>
          <b>{t('ui.config.routes')}</b>
        </div>
        {node.routes.length === 0 && <div style={{ color: greyColor }}>{t('ui.config.noRoute')}</div>}
        {node.routes.map((r, i) => (
          <div key={`${r.dest}-${r.prefix}-${r.nextHop}-${i}`} style={row}>
            <span>{t('ui.config.routeItem', { dest: r.dest, prefix: r.prefix, next: r.nextHop })}</span>
            {!locked && (
              <button style={dangerButton} onClick={() => onError(removeRoute(node.uid, i))}>
                {t('ui.config.remove')}
              </button>
            )}
          </div>
        ))}
        {!locked &&
          (hops.length === 0 ? (
            <div style={{ color: greyColor }}>{t('ui.config.noNextHop')}</div>
          ) : (
            <RouteAdd
              dests={[...dests.entries()].map(([value, d]) => ({ value, ...d }))}
              hops={hops}
              onAdd={(dest, prefix, nextHop) => onError(addRoute(node.uid, { dest, prefix, nextHop }))}
            />
          ))}
      </div>
    );
  };

  return (
    <div>
      <NameField key={node.uid} node={node} nodes={net.nodes} readOnly={readOnly} onError={onError} />
      {can(node.device, 'wireless') && <WirelessField key={`w-${node.uid}`} node={node} net={net} readOnly={readOnly} onError={onError} />}
      {node.configLocked && <div style={{ marginBottom: 6 }}>{t('ui.config.locked')}</div>}
      {ports.map(renderPort)}
      {!isRoutingCategory(category ?? '') && renderGateway()}
      {/* ファイアウォールも経路を持つ（直列の構成で、戻りの経路を置くため）。規則と静的ルートの両方を出す（N-fw） */}
      {isRoutingCategory(category ?? '') && renderRoutes()}
      {category === CATEGORY.firewall && renderFirewallRules()}
    </div>
  );
}

// ルートの追加。宛先とネクストホップの両方がそろった時点で追加する
// 規則の送信元・宛先の選択肢（すべて・配線の候補の社内のネットワーク・外部のネットワーク）
const FIREWALL_NETWORKS = [...NETWORK_CHOICES.map((n) => `${n}/24`), '203.0.113.0/24'];

// 規則の通信の種類の文字
const ruleServiceText = (r: { service: string; port?: number }): string =>
  r.service === 'http' ? `${t('ui.fw.service.http')}${r.port !== undefined ? `:${r.port}` : ''}` : tDyn(`ui.fw.service.${r.service}`);

// 規則を1つ追加する（送信元・宛先・通信の種類・ポート）
function FirewallRuleAdd({ onAdd }: { onAdd: (rule: { src: string; dst: string; service: 'any' | 'ping' | 'http'; port?: number }) => void }) {
  const [src, setSrc] = useState('any');
  const [dst, setDst] = useState('any');
  const [service, setService] = useState<'any' | 'ping' | 'http'>('http');
  const [port, setPort] = useState('80');
  const nets = [{ value: 'any', label: t('ui.fw.any') }, ...FIREWALL_NETWORKS.map((n) => ({ value: n, label: n }))];
  const add = () => {
    const p = Number(port);
    const rule = service === 'http' ? { src, dst, service, port: Number.isInteger(p) && p > 0 && p < 65536 ? p : 80 } : { src, dst, service };
    onAdd(rule);
  };
  return (
    <div style={{ ...row, flexWrap: 'wrap' }}>
      <PixelSelect<string> ariaLabel={t('ui.fw.src')} value={src} options={nets} onChange={setSrc} />
      <PixelSelect<string> ariaLabel={t('ui.fw.dst')} value={dst} options={nets} onChange={setDst} />
      <PixelSelect<string>
        ariaLabel={t('ui.fw.service')}
        value={service}
        options={[
          { value: 'any', label: t('ui.fw.service.any') },
          { value: 'ping', label: t('ui.fw.service.ping') },
          { value: 'http', label: t('ui.fw.service.http') },
        ]}
        onChange={(v) => setService(v as 'any' | 'ping' | 'http')}
      />
      {service === 'http' && (
        <input aria-label={t('ui.fw.port')} value={port} onChange={(e) => setPort(e.target.value)} style={{ width: 56 }} />
      )}
      <button style={primaryButton} onClick={add}>
        {t('ui.fw.add')}
      </button>
    </div>
  );
}

function RouteAdd({
  dests,
  hops,
  onAdd,
}: {
  dests: { value: string; network: string; prefix: number }[];
  hops: string[];
  onAdd: (dest: string, prefix: number, nextHop: string) => void;
}) {
  const [dest, setDest] = useState('');
  const [next, setNext] = useState('');
  const pick = (d: string, n: string) => {
    if (d && n) {
      const choice = dests.find((c) => c.value === d);
      if (choice) onAdd(choice.network, choice.prefix, n);
      setDest('');
      setNext('');
    } else {
      setDest(d);
      setNext(n);
    }
  };
  return (
    <div style={row}>
      <PixelSelect<string>
        ariaLabel={t('ui.config.routeDest')}
        value={dest}
        disabled={dests.length === 0}
        options={[{ value: '', label: t('ui.config.routeDest') }, ...dests.map((d) => ({ value: d.value, label: d.value }))]}
        onChange={(v) => pick(v, next)}
      />
      <PixelSelect<string>
        ariaLabel={t('ui.config.routeNext')}
        value={next}
        options={[{ value: '', label: t('ui.config.routeNext') }, ...hops.map((ip) => ({ value: ip, label: ip }))]}
        onChange={(v) => pick(dest, v)}
      />
    </div>
  );
}

// 機器の名前の欄。欄を離れたとき・Enter で確定する。空にすると既定の名前に戻る
// 無線の設定（N152）: SSID とパスワード。アクセスポイントと無線の端末の SSID・パスワードが合うとつながる。空欄は未設定
function WirelessField({ node, net, readOnly, onError }: { node: NetNode; net: Network; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setWireless = useGameStore((s) => s.setWireless);
  const store = useGameStore.getState();
  // 画面の表示と同じ電波の計算（壁の減衰を含む）で、つながりを出す
  const engine = engineWithWalls(gameEnv.engine, store.maps[focusedProject(store)?.contract.map ?? 'hq']);
  const pairs = wirelessAssociations(net, engine);
  const status = pairs.find((p) => p.client.uid === node.uid);
  const clients = pairs.filter((p) => p.ap.uid === node.uid).length;
  // アクセスポイントは、つながっている端末の数を出す。端末は、つながった先か、つながっていないことを出す
  const isClient = gameEnv.devices[node.device]?.category !== CATEGORY.accessPoint && gameEnv.devices[node.device]?.category !== CATEGORY.homeRouter;
  const statusText = status
    ? t('ui.wireless.connected', { ap: nodeLabel(store, status.ap, net.nodes) })
    : isClient
      ? t('ui.wireless.none')
      : t('ui.wireless.clients', { n: clients });
  const [ssid, setSsid] = useState(node.wireless?.ssid ?? '');
  const [password, setPassword] = useState(node.wireless?.password ?? '');
  const commit = (key: 'ssid' | 'password', value: string) => {
    if ((node.wireless?.[key] ?? '') === value) return;
    onError(setWireless(node.uid, key, value));
  };
  const field = (label: string, value: string, setValue: (v: string) => void, key: 'ssid' | 'password', type: string) => (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 2 }}>{label}</label>
      <input
        aria-label={label}
        type={type}
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
        value={value}
        disabled={readOnly}
        maxLength={32}
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => commit(key, value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
    </div>
  );
  return (
    <div style={sectionStyle}>
      {field(t('ui.wireless.ssid'), ssid, setSsid, 'ssid', 'text')}
      {field(t('ui.wireless.password'), password, setPassword, 'password', 'password')}
      <div style={{ fontSize: 12 }}>{statusText}</div>
    </div>
  );
}

function NameField({ node, nodes, readOnly, onError }: { node: NetNode; nodes: readonly NetNode[]; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setName = useGameStore((s) => s.setName);
  const current = nodeLabel(useGameStore.getState(), node, nodes);
  const [text, setText] = useState(node.name ?? '');
  const commit = () => {
    if ((node.name ?? '') === text.trim()) return;
    onError(setName(node.uid, text));
  };
  return (
    <div style={{ marginBottom: 8 }}>
      <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 2 }}>{t('ui.config.name')}</label>
      <input
        aria-label={t('ui.config.name')}
        style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
        value={text}
        placeholder={current}
        disabled={readOnly}
        maxLength={24}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setText(node.name ?? '');
        }}
      />
    </div>
  );
}
