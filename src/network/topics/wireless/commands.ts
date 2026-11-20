// 無線の論点の命令。
import { getComponent } from '../../components';
import { can } from '../../capabilities';
import { wirelessAssociations } from '../../engine/stages/links';
import { changed, nameOf, out, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec } from '../../command/types';
import type { Tr, TerminalLine } from '../../terminal';
import { wirelessQualityOf } from '../../query/wirelessQuality';
import { channelOf } from '../../wirelessBand';
import { isDfsChannel } from '../../../registry/wireless';
import type { MacListOp } from '../../../sim/project';

const WIRELESS = { word: 'wireless' } as const;

// 認証の形（security）。書式の語は言語ファイルの書式の語と同じで、内部の名前に直す
const SECURITY: readonly { word: string; name: 'open' | 'wep' | 'wpa' | 'wpa2' | 'wpa3' | 'wpa2wpa3' | 'wpa2_eap' | 'wpa3_eap' }[] = [
  { word: 'open', name: 'open' },
  { word: 'wep', name: 'wep' },
  { word: 'wpa', name: 'wpa' },
  { word: 'wpa2', name: 'wpa2' },
  { word: 'wpa3', name: 'wpa3' },
  { word: 'wpa2-wpa3', name: 'wpa2wpa3' },
  { word: 'wpa2-eap', name: 'wpa2_eap' },
  { word: 'wpa3-eap', name: 'wpa3_eap' },
];

// 命令の名前の一部（wirelessSecurity の後ろ）。wpa2_eap は Wpa2Eap、wpa2wpa3 は Wpa2wpa3
const pascal = (name: string): string => name.split('_').map((p) => p[0].toUpperCase() + p.slice(1)).join('');

// 無線の設定（SSID・帯・チャネル・方式・RADIUS）と、つながっていれば通信の品質を出す
const showWireless = (ctx: CommandContext, tr: Tr): CommandResult => {
  const { node, state } = ctx;
  if (!can(node.device, 'wireless')) return shown([out(tr('ui.terminal.wlNone'))]);
  const wifi = getComponent(node, 'wireless');
  const lines: TerminalLine[] = [];
  if (wifi?.ssid !== undefined) lines.push(out(tr('ui.terminal.wlSsid', { ssid: wifi.ssid })));
  if (can(node.device, 'accessPoint') && wifi?.band !== undefined) {
    const channel = channelOf(node);
    lines.push(out(tr('ui.terminal.wlBand', { band: tr(wifi.band === '2.4' ? 'ui.wireless.band24' : 'ui.wireless.band5') })));
    lines.push(out(tr('ui.terminal.wlChannel', { channel })));
    if (isDfsChannel(channel)) lines.push(out(tr('ui.wireless.dfs')));
    lines.push(out(tr('ui.terminal.wlSecurity', { security: tr(`ui.wireless.sec.${wifi.security ?? 'wpa2'}`) })));
    if (wifi.radius !== undefined) lines.push(out(tr('ui.terminal.wlRadius', { ip: wifi.radius })));
    if (wifi.macs !== undefined) lines.push(out(tr('ui.terminal.wlMacFilter', { macs: wifi.macs.length > 0 ? wifi.macs.join(', ') : tr('ui.terminal.portSecurityEmpty') })));
  }
  if (!can(node.device, 'accessPoint')) {
    const pair = wirelessAssociations(state.input, state.world).find((p) => p.client.uid === node.uid);
    if (pair !== undefined) {
      lines.push(out(tr('ui.wireless.connected', { ap: nameOf(ctx, pair.ap) })));
      const quality = wirelessQualityOf(state, node.uid);
      if (quality !== null) lines.push(out(tr('ui.wireless.quality', { q: tr(`ui.wireless.quality.${quality}`) })));
    }
  }
  return shown(lines.length > 0 ? lines : [out(tr('ui.terminal.wlNone'))]);
};

// 無線の MAC フィルター（N153）: wireless mac-filter（有効）・wireless mac-filter <MAC>（登録）と、no の形
const MAC = { arg: 'mac', name: 'mac' } as const;
const macFilter = (id: string, tokens: CommandSpec['tokens'], change: (args: Record<string, string>) => MacListOp): CommandSpec => ({
  id: `wireless.${id}`,
  modes: ['exec', 'config'],
  tokens,
  help: `ui.cmd.wireless.${id}`,
  writes: true,
  topic: 'wireless',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wirelessMacs', change: change(args) }),
});

export const commands: readonly CommandSpec[] = [
  macFilter('wirelessMacFilter', [WIRELESS, { word: 'mac-filter' }], () => ({ op: 'on' })),
  macFilter('noWirelessMacFilter', [{ word: 'no' }, WIRELESS, { word: 'mac-filter' }], () => ({ op: 'off' })),
  macFilter('wirelessMacFilterAdd', [WIRELESS, { word: 'mac-filter' }, MAC], (a) => ({ op: 'add', mac: a.mac })),
  macFilter('noWirelessMacFilterAdd', [{ word: 'no' }, WIRELESS, { word: 'mac-filter' }, MAC], (a) => ({ op: 'remove', mac: a.mac })),
  {
    id: 'wireless.wirelessSsid',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'ssid' }, { arg: 'ssid', name: 'value' }],
    help: 'ui.cmd.wireless.wirelessSsid',
    writes: true,
    topic: 'wireless',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'ssid', value: args.value }),
  },
  {
    id: 'wireless.wirelessPassword',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'password' }, { arg: 'psk', name: 'value' }],
    help: 'ui.cmd.wireless.wirelessPassword',
    writes: true,
    topic: 'wireless',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'password', value: args.value }),
  },
  // 帯（2.4GHz・5GHz）。機器が選べない帯は設定の検査（sim/netEdit）で拒否する
  {
    id: 'wireless.wirelessBand24',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'band' }, { word: '2.4' }],
    help: 'ui.cmd.wireless.wirelessBand24',
    writes: true,
    topic: 'wireless',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'band', value: '2.4' }),
  },
  {
    id: 'wireless.wirelessBand5',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'band' }, { word: '5' }],
    help: 'ui.cmd.wireless.wirelessBand5',
    writes: true,
    topic: 'wireless',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'band', value: '5' }),
  },
  // チャネルの形は、どの帯の番号でもよい（args.ts）。帯で選べない番号は設定の検査が拒否する
  {
    id: 'wireless.wirelessChannel',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'channel' }, { arg: 'channel', name: 'value' }],
    help: 'ui.cmd.wireless.wirelessChannel',
    writes: true,
    topic: 'wireless',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'channel', value: Number(args.value) }),
  },
  {
    id: 'wireless.wirelessVlan',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'vlan' }, { arg: 'vlan', name: 'value' }],
    help: 'ui.cmd.wireless.wirelessVlan',
    writes: true,
    topic: 'wireless',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'vlan', value: Number(args.value) }),
  },
  // 802.1X の RADIUS サーバーのアドレス。no で外す
  {
    id: 'wireless.wirelessRadiusServer',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'radius-server' }, { arg: 'ip', name: 'ip' }],
    help: 'ui.cmd.wireless.wirelessRadiusServer',
    writes: true,
    topic: 'wireless',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'radius', value: args.ip }),
  },
  {
    id: 'wireless.noWirelessRadiusServer',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, WIRELESS, { word: 'radius-server' }],
    help: 'ui.cmd.wireless.noWirelessRadiusServer',
    writes: true,
    topic: 'wireless',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'radius', value: null }),
  },
  ...SECURITY.map(({ word, name }) => ({
    id: `wireless.wirelessSecurity${pascal(name)}`,
    modes: ['exec', 'config'] as const,
    tokens: [WIRELESS, { word: 'security' }, { word }],
    help: `ui.cmd.wireless.wirelessSecurity${pascal(name)}`,
    writes: true,
    topic: 'wireless',
    run: (_args: Readonly<Record<string, string>>, ctx: CommandContext, tr: Tr) => changed(ctx, tr, { kind: 'wireless', key: 'security', value: name }),
  })),
  {
    id: 'wireless.showWireless',
    modes: ['exec'],
    tokens: [{ word: 'show' }, WIRELESS],
    help: 'ui.cmd.wireless.showWireless',
    writes: false,
    topic: 'wireless',
    run: (_args, ctx, tr) => showWireless(ctx, tr),
  },
];
