// RIP の論点の命令。
import { learnedRoutesOf } from '../../query/learnedRoutes';
import { changed, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { enterRouter } from '../../command/modes';

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
  {
    id: 'rip.router',
    modes: ['exec', 'config'],
    tokens: [{ word: 'router' }, { word: 'rip' }],
    help: '',
    writes: true,
    topic: 'rip',
    run: (_args, ctx, tr) => enterRouter(ctx, changed(ctx, tr, { kind: 'routing', change: { proto: 'rip', on: true } }), 'router-rip', null),
  },
  {
    id: 'rip.noRouter',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'router' }, { word: 'rip' }],
    help: '',
    writes: true,
    topic: 'rip',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'routing', change: { proto: 'rip', on: false } }),
  },
  {
    id: 'rip.network',
    modes: ['exec', 'config', 'router-rip'],
    tokens: [{ word: 'network' }, { arg: 'ip', name: 'ip' }],
    help: '',
    writes: true,
    topic: 'rip',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'routing', change: { proto: 'rip', ip: args.ip, on: true } }),
  },
  {
    id: 'rip.noNetwork',
    modes: ['exec', 'config', 'router-rip'],
    tokens: [{ word: 'no' }, { word: 'network' }, { arg: 'ip', name: 'ip' }],
    help: '',
    writes: true,
    topic: 'rip',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'routing', change: { proto: 'rip', ip: args.ip, on: false } }),
  },
];
