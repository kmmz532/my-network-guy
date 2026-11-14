// DHCP の論点の命令。
import { dhcpOf } from '../../query/dhcp';
import { changed, err, nameOf, out, shown } from '../../command/lines';
import type { DhcpPool } from '../../dhcp';
import type { CommandSpec } from '../../command/types';
import { isIp, maskToPrefix, port } from '../../command/args';

export const commands: readonly CommandSpec[] = [
  {
    id: 'dhcp.showIpDhcpBinding',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'dhcp' }, { word: 'binding' }],
    help: '',
    writes: false,
    topic: 'dhcp',
    run: (_args, ctx, tr) => {
      const { node } = ctx;
      // 配ったアドレス（このサーバーが配ったもの）。割り当ては毎回計算で求める
      const leases = dhcpOf(ctx.state).leases.filter((l) => l.server === node.uid);
      if (leases.length === 0) return shown([out(tr('ui.terminal.dhcpNone'))]);
      return shown(leases.map((l) => out(tr('ui.terminal.dhcpBinding', { ip: l.ip, name: nameOf(ctx, ctx.nodes.find((n) => n.uid === l.uid) ?? node), port: l.port }))));
    },
  },
  {
    id: 'dhcp.ipHelperAddress',
    modes: ['exec'],
    tokens: [{ word: 'ip' }, { word: 'helper-address' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'dhcp',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 2 || port(words[0]) === null || !isIp(words[1])) return shown([err(tr('ui.terminal.usageDhcp'))]);
      return changed(ctx, tr, { kind: 'dhcp', change: { op: 'helper', port: Number(words[0]), ip: words[1] } });
    },
  },
  {
    id: 'dhcp.noIpHelperAddress',
    modes: ['exec'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'helper-address' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'dhcp',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1 || port(words[0]) === null) return shown([err(tr('ui.terminal.usageDhcp'))]);
      return changed(ctx, tr, { kind: 'dhcp', change: { op: 'helper', port: Number(words[0]), ip: null } });
    },
  },
  {
    id: 'dhcp.ipDhcpPool',
    modes: ['exec'],
    tokens: [{ word: 'ip' }, { word: 'dhcp' }, { word: 'pool' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'dhcp',
    run: (args, ctx, tr) => {
      const [network, mask, start, end, ...opts] = args.args.split(' ').filter((w) => w !== '');
      const prefix = maskToPrefix(mask ?? '');
      if (!isIp(network ?? '') || prefix === null || !isIp(start ?? '') || !isIp(end ?? '') || opts.length % 2 !== 0) return shown([err(tr('ui.terminal.usageDhcp'))]);
      const pool: DhcpPool = { network, prefix, start, end };
      for (let i = 0; i < opts.length; i += 2) {
        if ((opts[i] !== 'gateway' && opts[i] !== 'dns') || !isIp(opts[i + 1])) return shown([err(tr('ui.terminal.usageDhcp'))]);
        pool[opts[i] as 'gateway' | 'dns'] = opts[i + 1];
      }
      return changed(ctx, tr, { kind: 'dhcp', change: { op: 'pool', pool } });
    },
  },
  {
    id: 'dhcp.noIpDhcpPool',
    modes: ['exec'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'dhcp' }, { word: 'pool' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'dhcp',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1 || !isIp(words[0])) return shown([err(tr('ui.terminal.usageDhcp'))]);
      return changed(ctx, tr, { kind: 'dhcp', change: { op: 'noPool', network: words[0] } });
    },
  },
];
