// 静的経路の論点の命令。
import { adOf } from '../../engine/stages/routing';
import { learnedRoutesOf } from '../../query/learnedRoutes';
import { networkAddress } from '../../segments';
import { prefixOfMask } from '../../command/args';
import type { TerminalLine } from '../../terminal';
import { changed, err, out, readOnlyLine, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'static_route.showIpRoute',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'route' }],
    help: '',
    writes: false,
    topic: 'static_route',
    run: (_args, ctx, tr) => {
      const { node } = ctx;
      const lines: TerminalLine[] = node.interfaces.map((i) =>
        out(tr('ui.terminal.routeConnected', { net: networkAddress(i.ip, i.prefix), prefix: i.prefix, port: i.port })),
      );
      // 静的経路は S（既定の経路は S*）。各行に [管理距離/メトリック] を出す
      const ad = adOf({ dest: '', prefix: 0, nextHop: '', protocol: 'static' });
      if (node.gateway) lines.push(out(tr('ui.terminal.routeStaticDefault', { dest: '0.0.0.0', prefix: 0, nextHop: node.gateway, ad, metric: 0 })));
      for (const r of node.routes) lines.push(out(tr(r.prefix === 0 ? 'ui.terminal.routeStaticDefault' : 'ui.terminal.routeStatic', { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop, ad, metric: 0 })));
      for (const protocol of ['rip', 'ospf', 'bgp'] as const) {
        for (const r of learnedRoutesOf(ctx.state, node.uid, protocol)) {
          const key = protocol === 'ospf' && r.interArea ? 'ui.terminal.routeOspfIa' : `ui.terminal.route${protocol[0].toUpperCase()}${protocol.slice(1)}`;
          lines.push(out(tr(key, { dest: r.dest, prefix: r.prefix, nextHop: r.nextHop, ad: adOf(r), metric: r.metric ?? 0 })));
        }
      }
      return shown(lines.length > 0 ? lines : [out(tr('ui.terminal.noRoute'))]);
    },
  },
  {
    id: 'static_route.ipRoute',
    modes: ['exec', 'config'],
    tokens: [{ word: 'ip' }, { word: 'route' }, { arg: 'ip', name: 'dest' }, { arg: 'mask', name: 'mask' }, { arg: 'ip', name: 'nextHop' }],
    help: '',
    writes: true,
    topic: 'static_route',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'addRoute', route: { dest: args.dest, prefix: prefixOfMask(args.mask), nextHop: args.nextHop } }),
  },
  {
    id: 'static_route.noIpRoute',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'route' }, { arg: 'ip', name: 'dest' }, { arg: 'mask', name: 'mask' }],
    help: '',
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
    help: '',
    writes: true,
    topic: 'static_route',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'gateway', gateway: args.gateway }),
  },
  {
    id: 'static_route.noIpDefaultGateway',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'default-gateway' }],
    help: '',
    writes: true,
    topic: 'static_route',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'gateway', gateway: null }),
  },
];
