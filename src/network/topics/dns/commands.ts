// DNS の論点の命令。
import { out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

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
];
