// SVI（VLAN のインターフェース）の論点の命令。
import { changed } from '../../command/lines';
import { prefixOfMask } from '../../command/args';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'svi.ipAddressVlan',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'address' }, { word: 'vlan' }, { arg: 'vlan', name: 'vlan' }, { arg: 'ip', name: 'ip' }, { arg: 'mask', name: 'mask' }],
    help: '',
    writes: true,
    topic: 'svi',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'svi', vlan: Number(args.vlan), ip: args.ip, prefix: prefixOfMask(args.mask) }),
  },
  {
    id: 'svi.noIpAddressVlan',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'address' }, { word: 'vlan' }, { arg: 'vlan', name: 'vlan' }],
    help: '',
    writes: true,
    topic: 'svi',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'svi', vlan: Number(args.vlan), ip: '', prefix: 24 }),
  },
];
