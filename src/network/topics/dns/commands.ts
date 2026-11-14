// DNS の論点の命令。
import { changed, err, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { isHostName, isIp } from '../../terminalConfig';

export const commands: readonly CommandSpec[] = [
  {
    id: 'dns.showHosts',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'hosts' }],
    help: '',
    writes: false,
    topic: 'dns',
    run: (_args, { node }, tr) => {
      const hosts = node.hosts ?? [];
      return shown(hosts.length > 0 ? hosts.map((h) => out(tr('ui.terminal.hostLine', { name: h.name, ip: h.ip }))) : [out(tr('ui.terminal.noHosts'))]);
    },
  },
  {
    id: 'dns.ipHost',
    modes: ['exec'],
    tokens: [{ word: 'ip' }, { word: 'host' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 2) return shown([err(tr('ui.terminal.usageHost'))]);
      if (!isHostName(words[0])) return shown([err(tr('ui.terminal.errHostname'))]);
      if (!isIp(words[1])) return shown([err(tr('ui.terminal.errIp'))]);
      return changed(ctx, tr, { kind: 'host', name: words[0], ip: words[1] });
    },
  },
  {
    id: 'dns.noIpHost',
    modes: ['exec'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'host' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1) return shown([err(tr('ui.terminal.usageNoHost'))]);
      if (!isHostName(words[0])) return shown([err(tr('ui.terminal.errHostname'))]);
      return changed(ctx, tr, { kind: 'removeHost', name: words[0] });
    },
  },
  {
    id: 'dns.ipNameServer',
    modes: ['exec'],
    tokens: [{ word: 'ip' }, { word: 'name-server' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1) return shown([err(tr('ui.terminal.usageNameServer'))]);
      if (!isIp(words[0])) return shown([err(tr('ui.terminal.errIp'))]);
      return changed(ctx, tr, { kind: 'nameServer', ip: words[0] });
    },
  },
  {
    id: 'dns.noIpNameServer',
    modes: ['exec'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'name-server' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 0) return shown([err(tr('ui.terminal.usageNameServer'))]);
      return changed(ctx, tr, { kind: 'nameServer', ip: null });
    },
  },
];
