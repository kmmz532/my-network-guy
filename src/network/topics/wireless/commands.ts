// 無線の論点の命令。
import { changed, err, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'wireless.wireless',
    modes: ['exec'],
    tokens: [{ word: 'wireless' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'wireless',
    // 続く語は無視する。キーごとに値の形を調べる
    run: (args, ctx, tr) => {
      const [key, value] = args.args.split(' ').filter((w) => w !== '');
      if (key === 'ssid' && value !== undefined && value.length <= 32) return changed(ctx, tr, { kind: 'wireless', key: 'ssid', value });
      if (key === 'password' && value !== undefined && value.length >= 8) return changed(ctx, tr, { kind: 'wireless', key: 'password', value });
      if (key === 'channel' && /^[0-9]+$/.test(value ?? '') && Number(value) >= 1 && Number(value) <= 13) return changed(ctx, tr, { kind: 'wireless', key: 'channel', value: Number(value) });
      if (key === 'vlan' && /^[0-9]+$/.test(value ?? '') && Number(value) >= 1) return changed(ctx, tr, { kind: 'wireless', key: 'vlan', value: Number(value) });
      if (key === 'security') {
        const names = { open: 'open', wep: 'wep', wpa: 'wpa', wpa2: 'wpa2', wpa3: 'wpa3', 'wpa2-wpa3': 'wpa2wpa3' } as const;
        const name = names[value as keyof typeof names];
        if (name !== undefined) return changed(ctx, tr, { kind: 'wireless', key: 'security', value: name });
      }
      return shown([err(tr('ui.terminal.usageWireless'))]);
    },
  },
];
