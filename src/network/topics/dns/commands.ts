// DNS の論点の命令。
import { changed, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'dns.showHosts',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'hosts' }],
    help: 'ui.cmd.dns.showHosts',
    writes: false,
    topic: 'dns',
    run: (_args, { node }, tr) => {
      const hosts = node.hosts ?? [];
      return shown(hosts.length > 0 ? hosts.map((h) => out(tr('ui.terminal.hostLine', { name: h.name, ip: h.ip }))) : [out(tr('ui.terminal.noHosts'))]);
    },
  },
  {
    id: 'dns.ipHost',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'host' }, { arg: 'hostname', name: 'name' }, { arg: 'ip', name: 'ip' }],
    help: 'ui.cmd.dns.ipHost',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'host', name: args.name, ip: args.ip }),
  },
  {
    id: 'dns.noIpHost',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'host' }, { arg: 'hostname', name: 'name' }],
    help: 'ui.cmd.dns.noIpHost',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'removeHost', name: args.name }),
  },
  {
    id: 'dns.ipNameServer',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'name-server' }, { arg: 'ip', name: 'ip' }],
    help: 'ui.cmd.dns.ipNameServer',
    writes: true,
    topic: 'dns',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'nameServer', ip: args.ip }),
  },
  {
    id: 'dns.noIpNameServer',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'name-server' }],
    help: 'ui.cmd.dns.noIpNameServer',
    writes: true,
    topic: 'dns',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'nameServer', ip: null }),
  },
];
