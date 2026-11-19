// 静的経路の論点の命令。
import { routeTableOf, type RouteRow } from '../../query/routeTable';
import type { Tr } from '../../terminal';
import { prefixOfMask } from '../../command/args';
import type { TerminalLine } from '../../terminal';
import { changed, err, out, readOnlyLine, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

// 経路の1行の文言（show ip route の書式）
const routeLine = (r: RouteRow, tr: Tr): string => {
  if (r.source === 'connected') return tr('ui.terminal.routeConnected', { net: r.dest, prefix: r.prefix, port: r.port });
  const params = { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop, ad: r.ad, metric: r.metric };
  if (r.source === 'static') return tr(r.prefix === 0 ? 'ui.terminal.routeStaticDefault' : 'ui.terminal.routeStatic', params);
  const key = { rip: 'ui.terminal.routeRip', ospf: 'ui.terminal.routeOspf', ospfIa: 'ui.terminal.routeOspfIa', bgp: 'ui.terminal.routeBgp' }[r.source];
  return tr(key, params);
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'static_route.showIpRoute',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'route' }],
    help: 'ui.cmd.static_route.showIpRoute',
    writes: false,
    topic: 'static_route',
    run: (_args, ctx, tr) => {
      // 経路の行は機器の経路表（欄と同じ）から作る。表示の文言だけをここで選ぶ
      const lines: TerminalLine[] = routeTableOf(ctx.state, ctx.node).map((r) => out(routeLine(r, tr)));
      return shown(lines.length > 0 ? lines : [out(tr('ui.terminal.noRoute'))]);
    },
  },
  {
    id: 'static_route.ipRoute',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'route' }, { arg: 'ip', name: 'dest' }, { arg: 'mask', name: 'mask' }, { arg: 'ip', name: 'nextHop' }],
    help: 'ui.cmd.static_route.ipRoute',
    writes: true,
    topic: 'static_route',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'addRoute', route: { dest: args.dest, prefix: prefixOfMask(args.mask), nextHop: args.nextHop } }),
  },
  {
    id: 'static_route.noIpRoute',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'route' }, { arg: 'ip', name: 'dest' }, { arg: 'mask', name: 'mask' }],
    help: 'ui.cmd.static_route.noIpRoute',
    writes: true,
    topic: 'static_route',
    run: (args, ctx, tr) => {
      // 読み取り専用の拒否は、経路の有無の検査より先
      if (ctx.readOnly) return shown([readOnlyLine(tr)]);
      const prefix = prefixOfMask(args.mask);
      const index = ctx.node.routes.findIndex((r) => r.dest === args.dest && r.prefix === prefix);
      if (index < 0) return shown([err(tr('ui.terminal.noRouteToRemove'))]);
      return changed(ctx, tr, { kind: 'removeRoute', index });
    },
  },
  {
    id: 'static_route.ipDefaultGateway',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'default-gateway' }, { arg: 'ip', name: 'gateway' }],
    help: 'ui.cmd.static_route.ipDefaultGateway',
    writes: true,
    topic: 'static_route',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'gateway', gateway: args.gateway }),
  },
  {
    id: 'static_route.noIpDefaultGateway',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'default-gateway' }],
    help: 'ui.cmd.static_route.noIpDefaultGateway',
    writes: true,
    topic: 'static_route',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'gateway', gateway: null }),
  },
];
