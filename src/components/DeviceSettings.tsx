// 機器の画面の「設定」タブ。ポートごとのIPアドレス（ネットワークは「詳しく」を開いたときだけ出す）、ホストのデフォルトゲートウェイ、ルーターの静的ルートを置く。
// IPアドレスとゲートウェイの欄は、候補から選べる1つの入力欄（AddressInput）にする。確定は候補を選んだとき・Enter・欄を離れたとき。
// PC・サーバーは、ケーブルでつなぐ前でもIPアドレスを設定できる。ルーターのポートはつないでから設定する。
import { useState } from 'react';
import type { LangKey } from '../generated/lang-keys';
import { t } from '../i18n/t';
import { AddressInput } from './AddressInput';
import type { ComboOption } from './addressCombo';
import type { Compiled } from '../network/compile';
import { colorOfNetwork, networkColors, UNSET_COLOR } from '../network/netColor';
import { networkAddress, neighborRouterAddresses, routerAddressesOn, segmentConfigOf, segmentOf, segmentsOf } from '../network/segments';
import type { NetNode, SegmentConfig } from '../network/types';
import { gameEnv } from '../sim/env';
import { addressCandidates, PLANNED_NETWORK, PLANNED_PREFIX, plannedAddressCandidates, type AddressCandidate } from '../sim/project';
import { coreOf, netTargetOf, useGameStore } from '../stores/useGameStore';
import { buttonStyle, greyColor, hexColor, isIpText, portLabel, sectionStyle, selectStyle, unsetColor } from './devicePorts';

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
  // 詳しくで選んだ、まだ設定のないポートのネットワーク（IPアドレスを設定したら消す）
  const [pending, setPending] = useState<Record<number, { network: string; prefix: number }>>({});

  const net = compiled.net;
  const engine = gameEnv.engine;
  const category = gameEnv.devices[node.device]?.category;
  if (category === 'l2_switch') return <div>{t('ui.config.noIp')}</div>;

  const byUid = new Map(net.nodes.map((n) => [n.uid, n]));
  const colors = networkColors(net, engine);
  const locked = readOnly || node.configLocked;
  const portCount = gameEnv.devices[node.device]?.portCount ?? 0;
  const ports = Array.from({ length: portCount }, (_, p) => p);

  const linked = (port: number) => net.links.some((l) => (l.a.node === node.uid && l.a.port === port) || (l.b.node === node.uid && l.b.port === port));
  // ポートのセグメントの設定（配線がなければ undefined）
  const cfgOf = (port: number): SegmentConfig | undefined => {
    const seg = segmentOf(segmentsOf(net, engine), node.uid, port);
    return seg ? segmentConfigOf(seg, byUid, net.segments) : undefined;
  };
  // 使用中のアドレスに付ける機器の名前（機器の名前とポートの名前）
  const usedName = (usedBy: { node: string; port: number }): string => {
    const n = byUid.get(usedBy.node);
    if (!n) return '';
    return `${t(`device.${n.device}.name` as LangKey)} ${portLabel(gameEnv.devices[n.device]?.category, usedBy.port)}`;
  };

  // IPアドレスを設定する。設定のないポートは、詳しくで選んだプレフィックス長（なければ /24）で設定する。
  // セグメントの設定は、配線のときと同じく IPアドレスから補う（fillSegments）
  const commitIp = (port: number, ip: string): string | null => {
    const cfg = cfgOf(port);
    const prefix = cfg ? cfg.prefix : (pending[port]?.prefix ?? PLANNED_PREFIX);
    const reason = setIface(node.uid, port, ip, prefix);
    if (!reason) {
      setPending((p0) => {
        const next = { ...p0 };
        delete next[port];
        return next;
      });
    }
    return reason;
  };

  const renderPort = (port: number) => {
    const label = portLabel(category, port);
    const heading = ports.length > 1 ? (
      <div>
        <b>{label}</b>
      </div>
    ) : null;
    // ルーターは、ケーブルでつないでから設定する
    if (!linked(port) && category === 'router') {
      return (
        <div key={port} style={sectionStyle}>
          {heading}
          <div style={{ color: greyColor }}>{t('ui.config.noCable')}</div>
        </div>
      );
    }
    const cfg = cfgOf(port);
    const iface = node.interfaces.find((i) => i.port === port);
    // 今のネットワーク: 設定があればそれ。なければ詳しくで選んだ値、IPアドレスがあればその /24、どちらもなければ既定
    const fromIface = iface ? { network: networkAddress(iface.ip, iface.prefix), prefix: iface.prefix } : null;
    const shown = cfg ?? pending[port] ?? fromIface ?? { network: PLANNED_NETWORK, prefix: PLANNED_PREFIX };
    const color = colorOfNetwork(colors, cfg?.network) ?? UNSET_COLOR;
    // 候補は、読み取り専用でなければ一覧にする（設定がなければ、今のネットワークの .10 から並べる）
    const candidates: AddressCandidate[] = readOnly
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
      setPending((p0) => ({ ...p0, [port]: next }));
      if (iface) onError(setIface(node.uid, port, ''));
    };
    const networks = cfg && !NETWORK_CHOICES.includes(cfg.network) ? [...NETWORK_CHOICES, cfg.network] : NETWORK_CHOICES;
    return (
      <div key={port} style={sectionStyle}>
        {heading}
        <div>
          {t('ui.config.ip')}: {iface ? <b>{iface.ip}</b> : <span style={{ color: unsetColor }}>{t('ui.config.unset')}</span>}
        </div>
        <div style={row}>
          <AddressInput
            label={t('ui.config.ip')}
            value={iface?.ip ?? ''}
            options={options}
            disabled={locked}
            isValid={isIpText}
            formatError={t('ui.config.ipFormat')}
            onCommit={(ip) => commitIp(port, ip)}
          />
        </div>
        <div style={{ ...row, fontSize: 12 }}>
          <span style={{ color: greyColor, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <span style={{ display: 'inline-block', width: 10, height: 10, background: hexColor(color), border: '1px solid #3b2a33' }} />
            {t('ui.config.networkLine', { network: shown.network, prefix: shown.prefix })}
          </span>
          <button style={buttonStyle} onClick={onToggleDetail}>
            {detailOpen ? t('ui.config.detailClose') : t('ui.config.detail')}
          </button>
        </div>
        {detailOpen && (
          <div style={row}>
            <select
              aria-label={t('ui.config.network')}
              style={selectStyle}
              value={shown.network}
              disabled={locked}
              onChange={(e) => {
                // 設定があれば、セグメントのネットワークを変える。なければ、詳しくで選んだ値として覚える
                if (cfg) onError(setSegment(node.uid, port, e.target.value, cfg.prefix));
                else changePlanned({ ...shown, network: e.target.value });
              }}
            >
              {networks.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
            <select
              aria-label={t('ui.config.prefix')}
              style={selectStyle}
              value={shown.prefix}
              disabled={locked}
              onChange={(e) => {
                const prefix = Number(e.target.value);
                if (cfg) onError(setSegment(node.uid, port, cfg.network, prefix));
                else changePlanned({ ...shown, prefix });
              }}
            >
              {PREFIX_CHOICES.map((p) => (
                <option key={p} value={p}>
                  /{p}
                </option>
              ))}
            </select>
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
                formatError={t('ui.config.ipFormat')}
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
              <button style={buttonStyle} onClick={() => onError(removeRoute(node.uid, i))}>
                {t('ui.config.remove')}
              </button>
            )}
          </div>
        ))}
        {!locked &&
          (dests.size === 0 ? (
            <div style={{ color: greyColor }}>{t('ui.config.noDest')}</div>
          ) : hops.length === 0 ? (
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
      {node.configLocked && <div style={{ marginBottom: 6 }}>{t('ui.config.locked')}</div>}
      {ports.map(renderPort)}
      {category !== 'router' && renderGateway()}
      {category === 'router' && renderRoutes()}
    </div>
  );
}

// ルートの追加。宛先とネクストホップの両方がそろった時点で追加する
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
      <select aria-label={t('ui.config.routeDest')} style={selectStyle} value={dest} onChange={(e) => pick(e.target.value, next)}>
        <option value="">{t('ui.config.routeDest')}</option>
        {dests.map((d) => (
          <option key={d.value} value={d.value}>
            {d.value}
          </option>
        ))}
      </select>
      <select aria-label={t('ui.config.routeNext')} style={selectStyle} value={next} onChange={(e) => pick(dest, e.target.value)}>
        <option value="">{t('ui.config.routeNext')}</option>
        {hops.map((ip) => (
          <option key={ip} value={ip}>
            {ip}
          </option>
        ))}
      </select>
    </div>
  );
}
