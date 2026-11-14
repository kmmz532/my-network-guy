// DHCP の論点の命令。
import { dhcpOf } from '../../query/dhcp';
import { nameOf, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

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
];
