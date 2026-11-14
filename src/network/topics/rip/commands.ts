// RIP の論点の命令。
import { learnedRoutesOf } from '../../query/learnedRoutes';
import { out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'rip.showIpRipDatabase',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'rip' }, { word: 'database' }],
    help: '',
    writes: false,
    topic: 'rip',
    run: (_args, ctx, tr) => {
      const routes = learnedRoutesOf(ctx.state, ctx.node.uid, 'rip');
      if (routes.length === 0) return shown([out(tr('ui.terminal.ripNone'))]);
      return shown(routes.map((r) => out(tr('ui.terminal.ripRoute', { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop }))));
    },
  },
];
