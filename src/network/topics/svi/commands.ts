// SVI（VLAN のインターフェース）の論点の命令。
import { isIp, maskToPrefix, vlanNumber } from '../../command/args';
import { changed, err, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'svi.ipAddressVlan',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'address' }, { word: 'vlan' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'svi',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 3) return shown([err(tr('ui.terminal.usageSvi'))]);
      const v = vlanNumber(words[0]);
      if (v === null) return shown([err(tr('ui.terminal.errVlan'))]);
      if (!isIp(words[1])) return shown([err(tr('ui.terminal.errIp'))]);
      const prefix = maskToPrefix(words[2]);
      if (prefix === null) return shown([err(tr('ui.terminal.errMask'))]);
      return changed(ctx, tr, { kind: 'svi', vlan: v, ip: words[1], prefix });
    },
  },
  {
    id: 'svi.noIpAddressVlan',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'address' }, { word: 'vlan' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'svi',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1) return shown([err(tr('ui.terminal.usageSvi'))]);
      const v = vlanNumber(words[0]);
      if (v === null) return shown([err(tr('ui.terminal.errVlan'))]);
      return changed(ctx, tr, { kind: 'svi', vlan: v, ip: '', prefix: 24 });
    },
  },
];
