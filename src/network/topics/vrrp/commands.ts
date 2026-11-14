// VRRP の論点の命令。
import { vrrpStatusOf } from '../../query/vrrpStatus';
import { out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'vrrp.showVrrp',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'vrrp' }],
    help: '',
    writes: false,
    topic: 'vrrp',
    run: (_args, ctx, tr) => {
      const groups = vrrpStatusOf(ctx.state, ctx.node.uid);
      if (groups.length === 0) return shown([out(tr('ui.terminal.vrrpNone'))]);
      return shown(groups.map((g) => out(tr('ui.terminal.vrrpGroup', { iface: g.iface, vrid: g.vrid, state: g.state, ip: g.ip, priority: g.priority, preempt: tr(g.preempt ? 'ui.terminal.vrrpPreemptOn' : 'ui.terminal.vrrpPreemptOff') }))));
    },
  },
];
