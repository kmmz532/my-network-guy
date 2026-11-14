// 無線の論点の命令。
import { changed } from '../../command/lines';
import type { CommandContext, CommandSpec } from '../../command/types';
import type { Tr } from '../../terminal';

const WIRELESS = { word: 'wireless' } as const;

// 認証の形（security）。書式の語は言語ファイルの書式の語と同じで、内部の名前に直す
const SECURITY: readonly { word: string; name: 'open' | 'wep' | 'wpa' | 'wpa2' | 'wpa3' | 'wpa2wpa3' }[] = [
  { word: 'open', name: 'open' },
  { word: 'wep', name: 'wep' },
  { word: 'wpa', name: 'wpa' },
  { word: 'wpa2', name: 'wpa2' },
  { word: 'wpa3', name: 'wpa3' },
  { word: 'wpa2-wpa3', name: 'wpa2wpa3' },
];

export const commands: readonly CommandSpec[] = [
  {
    id: 'wireless.wirelessSsid',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'ssid' }, { arg: 'ssid', name: 'value' }],
    help: '',
    writes: true,
    topic: 'wireless',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'ssid', value: args.value }),
  },
  {
    id: 'wireless.wirelessPassword',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'password' }, { arg: 'psk', name: 'value' }],
    help: '',
    writes: true,
    topic: 'wireless',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'password', value: args.value }),
  },
  {
    id: 'wireless.wirelessChannel',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'channel' }, { arg: 'channel', name: 'value' }],
    help: '',
    writes: true,
    topic: 'wireless',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'channel', value: Number(args.value) }),
  },
  {
    id: 'wireless.wirelessVlan',
    modes: ['exec', 'config'],
    tokens: [WIRELESS, { word: 'vlan' }, { arg: 'vlan', name: 'value' }],
    help: '',
    writes: true,
    topic: 'wireless',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'wireless', key: 'vlan', value: Number(args.value) }),
  },
  ...SECURITY.map(({ word, name }) => ({
    id: `wireless.wirelessSecurity${name[0].toUpperCase()}${name.slice(1)}`,
    modes: ['exec', 'config'] as const,
    tokens: [WIRELESS, { word: 'security' }, { word }],
    help: '',
    writes: true,
    topic: 'wireless',
    run: (_args: Readonly<Record<string, string>>, ctx: CommandContext, tr: Tr) => changed(ctx, tr, { kind: 'wireless', key: 'security', value: name }),
  })),
];
