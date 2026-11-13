// 機器の画面の「設定」タブ。ポートごとのIPアドレス（ネットワークは「詳しく」を開いたときだけ出す）、ホストのデフォルトゲートウェイ、ルーターの静的ルートを置く。
// IPアドレスとゲートウェイの欄は、候補から選べる1つの入力欄（AddressInput）にする。確定は候補を選んだとき・Enter・欄を離れたとき。
// PC・サーバーは、ケーブルでつなぐ前でもIPアドレスを設定できる。ルーターのポートはつないでから設定する。
import { nodeLabel } from './nodeLabel';
import { useState } from 'react';
import { t, tDyn } from '../i18n/t';
import { AddressInput } from './AddressInput';
import { ComboBox } from './ComboBox';
import { PixelSelect } from './PixelControls';
import { primaryButton } from './Modal';
import { dangerButton } from './Modal';
import type { ComboOption } from './comboOptions';
import { isRelayPort, isRoutingCategory } from '../network/category';
import { can } from '../network/capabilities';
import { wirelessAssociations } from '../network/engine/stages/links';
import { channelOverlapsOf, networkColors, type NetworkState } from '../network/public';
import { colorOfNetwork, UNSET_COLOR } from '../network/netColor';
import { networkAddress, planFor } from '../network/segments';
import { neighborRouterAddresses, planOf, routerAddressesOn } from '../network/query/plans';
import type { NetNode, NetworkPlan } from '../network/types';
import { gameEnv } from '../sim/env';
import { addressCandidates, PLANNED_NETWORK, PLANNED_PREFIX, plannedAddressCandidates, type AddressCandidate } from '../sim/project';
import { coreOf, netOfDevice, netTargetOf, plannedKey, useGameStore } from '../stores/useGameStore';
import { buttonStyle, greyColor, hexColor, inputStyle, isIpText, portLabel, sectionStyle, unsetColor } from './devicePorts';
import { CATEGORY } from '../data/categories';
import { BgpField } from './BgpField';
import { IspField } from './IspField';
import { VlanPortField } from './VlanPortField';
import { VrrpField } from './VrrpField';
import { ChannelField } from './ChannelField';
import { SviField } from './SviField';
import { DhcpPoolField, DhcpPortField } from './DhcpField';
import { portCountOf, deviceCategory } from '../registry/query';

// ネットワークの既定候補（入力欄から任意のネットワークも指定できる）
const NETWORK_CHOICES = Array.from({ length: 16 }, (_, i) => `192.168.${i + 1}.0`);
const PREFIX_CHOICES = [24, 25, 26, 27, 28, 29, 30];

const row = { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', margin: '4px 0' } as const;

interface Props {
  node: NetNode;
  readOnly: boolean;
  // 「詳しく」を開いているか。機器の画面を閉じるまで親が覚える
  detailOpen: boolean;
  onToggleDetail: () => void;
  onError: (reason: string | null) => void;
}

export function DeviceSettings({ node, readOnly, detailOpen, onToggleDetail, onError }: Props) {
  const state = useGameStore();
  const setIface = useGameStore((s) => s.setIface);
  const setGateway = useGameStore((s) => s.setGateway);
  const setPlan = useGameStore((s) => s.setPlan);
  const setRouting = useGameStore((s) => s.setRouting);
  const setOspf = useGameStore((s) => s.setOspf);
  const setPower = useGameStore((s) => s.setPower);
  const addRoute = useGameStore((s) => s.addRoute);
  const removeRoute = useGameStore((s) => s.removeRoute);
  const setFirewallRules = useGameStore((s) => s.setFirewallRules);
  // 詳しくで選んだ、まだ設定のないポートのネットワーク（IPアドレスを設定したら消す）。ストアに持ち、配線の自動割り当てで使う
  const planned = useGameStore((s) => s.planned);
  const setPlanned = useGameStore((s) => s.setPlanned);

  // 画面の計算は、ストアの計算の結果を読む
  const netState = useGameStore((s) => netOfDevice(s, node.uid));
  // 配線（保存の構成）
  const net = netState.input;
  const category = deviceCategory(node.device);

  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  const colors = networkColors(netState);
  const locked = readOnly || node.configLocked;
  const portCount = portCountOf(node.device);
  // IPアドレスを持つ口（スイッチ付きルーターの2つ目以降の LAN 口は中継だけなので欄を出さない）
  const ports = Array.from({ length: portCount }, (_, p) => p).filter((p) => !isRelayPort(category ?? '', p));

  const linked =(port: number) => net.links.some((l) => (l.a.node === node.uid && l.a.port === port) || (l.b.node === node.uid && l.b.port === port));
  // 口の L2 ドメインのアドレスの計画（無線の端末は、つながるアクセスポイントのドメイン。配線がなければ undefined）
  const cfgOf = (port: number): NetworkPlan | undefined => planOf(netState, { node: node.uid, port });
  // 使用中のアドレスに付ける機器の名前（機器の名前とポートの名前）
  const usedName = (usedBy: { node: string; port: number }): string => {
    const n = byUid.get(usedBy.node);
    if (!n) return '';
    return `${nodeLabel(useGameStore.getState(), n, net.nodes)} ${portLabel(deviceCategory(n.device), usedBy.port)}`;
  };

  // IPアドレスを設定する。設定のないポートは、詳しくで選んだプレフィックス長（なければ /24）で設定する。
  // アドレスの計画は、配線のときと同じく IPアドレスから補う（fillPlans）
  const commitIp = (port: number, ip: string): string | null => {
    const cfg = cfgOf(port);
    const plan = planned[plannedKey(node.uid, port)];
    const prefix = cfg ? cfg.prefix : (plan?.prefix ?? PLANNED_PREFIX);
    const reason = setIface(node.uid, port, ip, prefix);
    if (reason) return reason;
    // 未設定または初期値の /24 なら、入力した IP からネットワークを決める。
    // /25〜/30 や、詳しく設定した別ネットワークはプレイヤーの指定を優先する。
    const canAutoSet =
      prefix === PLANNED_PREFIX &&
      (!plan || (plan.network === PLANNED_NETWORK && plan.prefix === PLANNED_PREFIX)) &&
      (!cfg || (cfg.network === PLANNED_NETWORK && cfg.prefix === PLANNED_PREFIX));
    if (canAutoSet) {
      const autoNetwork = networkAddress(ip, prefix);
      const planReason = setPlan(node.uid, port, autoNetwork, prefix);
      if (planReason) return planReason;
    }
    setPlanned(node.uid, port, null);
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
    const networkOptions: ComboOption[] = [
      ...NETWORK_CHOICES,
      ...(NETWORK_CHOICES.includes(shown.network) ? [] : [shown.network]),
    ].map((network) => ({ value: network, usedBy: null }));
    return (
      <div key={port} style={unlinkedRouter ? { ...sectionStyle, opacity: 0.45 } : sectionStyle}>
        {heading}
        {can(node.device, 'switchport') && <VlanPortField node={node} port={port} readOnly={locked} onError={onError} />}
        {can(node.device, 'lag') && <ChannelField node={node} port={port} disabled={locked || unlinkedRouter} onError={onError} />}
        <div>
          {t('ui.config.ip')}: {iface ? <b>{iface.ip}</b> : <span style={{ color: unsetColor }}>{t('ui.config.unset')}</span>}
        </div>
        <DhcpPortField node={node} port={port} iface={iface} client={!isRoutingCategory(category ?? '') && !can(node.device, 'switchport')} disabled={locked || unlinkedRouter} onError={onError} />
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
        {iface && isRoutingCategory(category ?? '') && (
          <div style={row}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                aria-label={t('ui.config.ripJoin')}
                checked={iface.rip === true}
                disabled={locked || unlinkedRouter}
                onChange={(e) => onError(setRouting(node.uid, { proto: 'rip', on: e.target.checked, ip: iface.ip }))}
              />
              {t('ui.config.ripJoin')}
            </label>
          </div>
        )}
        {iface && isRoutingCategory(category ?? '') && (
          <div style={{ ...row, flexWrap: 'wrap', gap: 6 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              <input
                type="checkbox"
                aria-label={t('ui.config.ospfJoin')}
                checked={iface.ospf !== undefined}
                disabled={locked || unlinkedRouter}
                onChange={(e) => onError(setRouting(node.uid, { proto: 'ospf', on: e.target.checked, ip: iface.ip }))}
              />
              {t('ui.config.ospfJoin')}
            </label>
            {iface.ospf !== undefined &&
              (
                [
                  ['area', 'ui.config.ospfArea', iface.ospf.area, 0],
                  ['cost', 'ui.config.ospfCost', iface.ospf.cost ?? 1, 1],
                  ['priority', 'ui.config.ospfPriority', iface.ospf.priority ?? 1, 0],
                  ['hello', 'ui.config.ospfHello', iface.ospf.hello ?? 10, 1],
                  ['dead', 'ui.config.ospfDead', iface.ospf.dead ?? 40, 1],
                ] as const
              ).map(([key, label, value, min]) => (
                <label key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
                  {t(label)}
                  <input
                    type="number"
                    min={min}
                    defaultValue={value}
                    key={`${iface.id}-${key}-${value}`}
                    disabled={locked || unlinkedRouter}
                    style={{ ...inputStyle, width: 56 }}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (!Number.isInteger(v) || v < min || v === value) return;
                      onError(key === 'area' ? setRouting(node.uid, { proto: 'ospf', on: true, ip: iface.ip, area: v }) : setOspf(node.uid, { op: 'iface', id: iface.id, key, value: v }));
                    }}
                  />
                </label>
              ))}
          </div>
        )}
        {iface && can(node.device, 'vrrp') && <VrrpField node={node} iface={iface} disabled={locked || unlinkedRouter} onError={onError} />}
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
            <ComboBox
              label={t('ui.config.network')}
              value={shown.network}
              options={networkOptions}
              disabled={locked || unlinkedRouter}
              isValid={(network) => isIpText(network) && networkAddress(network, shown.prefix) === network}
              formatError={t('ui.error.ip')}
              onCommit={(network) => {
                if (cfg) return setPlan(node.uid, port, network, cfg.prefix);
                changePlanned({ ...shown, network });
                return null;
              }}
            />
            <PixelSelect<number>
              ariaLabel={t('ui.config.prefix')}
              value={shown.prefix}
              disabled={locked || unlinkedRouter}
              options={PREFIX_CHOICES.map((p) => ({ value: p, label: `/${p}` }))}
              onChange={(prefix) => {
                if (cfg) onError(setPlan(node.uid, port, cfg.network, prefix));
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
    const routers = routerAddressesOn(netState, node.uid, 0);
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
    for (const domain of netState.l2.planDomains) {
      const cfg = planFor(domain, byUid, net.plans);
      if (cfg) dests.set(`${cfg.network}/${cfg.prefix}`, { network: cfg.network, prefix: cfg.prefix });
    }
    const hops = neighborRouterAddresses(netState, node.uid);
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

  // OSPF に参加しているルーターだけに出す（ルーター ID・既定の経路の配布）
  const renderOspf = () => (
    <div style={sectionStyle}>
      <div style={{ ...row, flexWrap: 'wrap', gap: 6 }}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          {t('ui.config.ospfRouterId')}
          <input
            key={`rid-${node.ospf?.routerId ?? ''}`}
            defaultValue={node.ospf?.routerId ?? ''}
            disabled={locked}
            style={{ ...inputStyle, width: 110 }}
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v === (node.ospf?.routerId ?? '')) return;
              if (v !== '' && !isIpText(v)) return onError('ip');
              onError(setOspf(node.uid, { op: 'routerId', ip: v === '' ? null : v }));
            }}
          />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12 }}>
          <input
            type="checkbox"
            aria-label={t('ui.config.ospfDefault')}
            checked={node.ospf?.defaultOriginate === true}
            disabled={locked}
            onChange={(e) => onError(setOspf(node.uid, { op: 'defaultOriginate', on: e.target.checked }))}
          />
          {t('ui.config.ospfDefault')}
        </label>
      </div>
    </div>
  );

  return (
    <div>
      <NameField key={node.uid} node={node} nodes={net.nodes} readOnly={readOnly} onError={onError} />
      {category !== CATEGORY.uplink && (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4, margin: '4px 0' }}>
          <input type="checkbox" aria-label={t('ui.config.power')} checked={node.powered !== false} disabled={readOnly} onChange={(e) => onError(setPower(node.uid, e.target.checked))} />
          {t('ui.config.power')}
        </label>
      )}
      {can(node.device, 'wireless') && <WirelessField key={`w-${node.uid}`} node={node} state={netState} readOnly={readOnly} onError={onError} />}
      {node.configLocked && <div style={{ marginBottom: 6 }}>{t('ui.config.locked')}</div>}
      {ports.map(renderPort)}
      {can(node.device, 'svi') && category === CATEGORY.l3Switch && <SviField node={node} disabled={locked} onError={onError} />}
      {!isRoutingCategory(category ?? '') && renderGateway()}
      {/* ファイアウォールも経路を持つ（直列の構成で、戻りの経路を置くため）。規則と静的ルートの両方を出す（N-fw） */}
      {isRoutingCategory(category ?? '') && renderRoutes()}
      {isRoutingCategory(category ?? '') && node.interfaces.some((i) => i.ospf !== undefined) && renderOspf()}
      {can(node.device, 'services') && <DhcpPoolField key={`dhcp-${node.uid}`} node={node} disabled={locked} onError={onError} />}
      {category === CATEGORY.uplink && <IspField key={`isp-${node.uid}`} node={node} readOnly={locked} onError={onError} />}
      {can(node.device, 'bgp') && <BgpField key={`bgp-${node.uid}`} node={node} readOnly={locked} onError={onError} />}
      {isRoutingCategory(category ?? '') && <NatField node={node} readOnly={locked} onError={onError} />}
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
        <input aria-label={t('ui.fw.port')} value={port} onChange={(e) => setPort(e.target.value)} style={{ ...inputStyle, width: 56 }} />
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

// NAT の設定（N146）: 口ごとの inside・outside、NAPT の有効、静的 NAT（ポートの転送）
const NAT_ROLES = ['inside', 'outside'] as const;
function NatField({ node, readOnly, onError }: { node: NetNode; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setNat = useGameStore((s) => s.setNat);
  const [port, setPort] = useState('80');
  const [insideIp, setInsideIp] = useState('');
  const [insidePort, setInsidePort] = useState('80');
  const statics = node.statics ?? [];
  const addStatic = () => {
    const p = Number(port);
    const ip = Number(insidePort);
    if (!isIpText(insideIp) || !Number.isInteger(p) || p < 1 || p > 65535 || !Number.isInteger(ip) || ip < 1 || ip > 65535) {
      onError('nat.static_invalid');
      return;
    }
    onError(setNat(node.uid, { op: 'static', port: p, insideIp, insidePort: ip }));
    setInsideIp('');
  };
  return (
    <div style={sectionStyle}>
      <div>
        <b>{t('ui.nat.title')}</b>
      </div>
      {node.interfaces.map((i) => (
        <div key={i.id} style={row}>
          <span>{t('ui.nat.port', { id: i.id })}</span>
          <PixelSelect<string>
            ariaLabel={t('ui.nat.role')}
            value={i.nat ?? ''}
            disabled={readOnly}
            options={[{ value: '', label: t('ui.nat.none') }, ...NAT_ROLES.map((r) => ({ value: r, label: t(`ui.nat.${r}`) }))]}
            onChange={(v) => onError(setNat(node.uid, { op: 'iface', id: i.id, nat: v === '' ? null : (v as 'inside' | 'outside') }))}
          />
        </div>
      ))}
      <div style={row}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <input type="checkbox" aria-label={t('ui.nat.napt')} checked={node.napt === true} disabled={readOnly} onChange={(e) => onError(setNat(node.uid, { op: 'napt', on: e.target.checked }))} />
          {t('ui.nat.napt')}
        </label>
      </div>
      <div style={{ fontWeight: 'bold', marginTop: 6 }}>{t('ui.nat.statics')}</div>
      {statics.length === 0 && <div style={{ color: greyColor }}>{t('ui.nat.noStatic')}</div>}
      {statics.map((s) => (
        <div key={s.port} style={row}>
          <span>{t('ui.nat.staticItem', { port: s.port, ip: s.insideIp, insidePort: s.insidePort })}</span>
          {!readOnly && (
            <button style={dangerButton} onClick={() => onError(setNat(node.uid, { op: 'noStatic', port: s.port }))}>
              {t('ui.config.remove')}
            </button>
          )}
        </div>
      ))}
      {!readOnly && (
        <div style={row}>
          <input aria-label={t('ui.nat.outPort')} style={{ ...inputStyle, width: 60 }} value={port} onChange={(e) => setPort(e.target.value)} />
          <input aria-label={t('ui.nat.insideIp')} style={{ ...inputStyle, width: 110 }} value={insideIp} placeholder="192.168.1.10" onChange={(e) => setInsideIp(e.target.value)} />
          <input aria-label={t('ui.nat.insidePort')} style={{ ...inputStyle, width: 60 }} value={insidePort} onChange={(e) => setInsidePort(e.target.value)} />
          <button style={buttonStyle} onClick={addStatic}>
            {t('ui.fw.add')}
          </button>
        </div>
      )}
    </div>
  );
}

// 機器の名前の欄。欄を離れたとき・Enter で確定する。空にすると既定の名前に戻る
// 無線の設定（N152）: SSID とパスワード。アクセスポイントと無線の端末の SSID・パスワードが合うとつながる。空欄は未設定
function WirelessField({ node, state, readOnly, onError }: { node: NetNode; state: NetworkState; readOnly: boolean; onError: (reason: string | null) => void }) {
  const setWireless = useGameStore((s) => s.setWireless);
  const store = useGameStore.getState();
  const net = state.input;
  // 画面の表示と同じ電波の計算（壁の減衰を含む）で、つながりを出す
  const pairs = wirelessAssociations(net, state.world);
  const status = pairs.find((p) => p.client.uid === node.uid);
  const clients = pairs.filter((p) => p.ap.uid === node.uid).length;
  // アクセスポイントは、つながっている端末の数を出す。端末は、つながった先か、つながっていないことを出す
  const isClient = deviceCategory(node.device) !== CATEGORY.accessPoint && deviceCategory(node.device) !== CATEGORY.homeRouter;
  // 同じチャネルで近いアクセスポイントがあれば、注意を出す（N152）
  const overlapping = channelOverlapsOf(state).some((o) => o.a === node.uid || o.b === node.uid);
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
      {!isClient && (
        <div style={{ marginBottom: 8 }}>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: 2 }}>{t('ui.wireless.security')}</label>
          <select
            aria-label={t('ui.wireless.security')}
            value={node.wireless?.security ?? 'wpa2'}
            disabled={readOnly}
            onChange={(e) => onError(setWireless(node.uid, 'security', e.target.value))}
          >
            {(['open', 'wep', 'wpa', 'wpa2', 'wpa3', 'wpa2wpa3'] as const).map((s) => (
              <option key={s} value={s}>{t(`ui.wireless.sec.${s}`)}</option>
            ))}
          </select>
        </div>
      )}
      <div style={{ fontSize: 12 }}>{statusText}</div>
      {overlapping && <div style={{ fontSize: 12, color: "#ffd866" }}>{t("ui.wireless.overlap")}</div>}
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
