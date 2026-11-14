// 静的経路の論点の命令。
import { adOf } from '../../engine/stages/routing';
import { learnedRoutesOf } from '../../query/learnedRoutes';
import { networkAddress } from '../../segments';
import { isIp, maskToPrefix } from '../../command/args';
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
    modes: ['exec'],
    tokens: [{ word: 'ip' }, { word: 'route' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'static_route',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 3) return shown([err(tr('ui.terminal.usageRoute'))]);
      if (!isIp(words[0]) || !isIp(words[2])) return shown([err(tr('ui.terminal.errIp'))]);
      const prefix = maskToPrefix(words[1]);
      if (prefix === null) return shown([err(tr('ui.terminal.errMask'))]);
      return changed(ctx, tr, { kind: 'addRoute', route: { dest: words[0], prefix, nextHop: words[2] } });
    },
  },
  {
    id: 'static_route.noIpRoute',
    modes: ['exec'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'route' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'static_route',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 2) return shown([err(tr('ui.terminal.usageNoRoute'))]);
      if (!isIp(words[0])) return shown([err(tr('ui.terminal.errIp'))]);
      const prefix = maskToPrefix(words[1]);
      if (prefix === null) return shown([err(tr('ui.terminal.errMask'))]);
      // 読み取り専用の拒否は、経路の有無の検査より先
      if (ctx.readOnly) return shown([readOnlyLine(tr)]);
      const index = ctx.node.routes.findIndex((r) => r.dest === words[0] && r.prefix === prefix);
      if (index < 0) return shown([err(tr('ui.terminal.noRouteToRemove'))]);
      return changed(ctx, tr, { kind: 'removeRoute', index });
    },
  },
  {
    id: 'static_route.ipDefaultGateway',
    modes: ['exec'],
    tokens: [{ word: 'ip' }, { word: 'default-gateway' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'static_route',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1) return shown([err(tr('ui.terminal.usageGateway'))]);
      if (!isIp(words[0])) return shown([err(tr('ui.terminal.errIp'))]);
      return changed(ctx, tr, { kind: 'gateway', gateway: words[0] });
    },
  },
  {
    id: 'static_route.noIpDefaultGateway',
    modes: ['exec'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'default-gateway' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'static_route',
    run: (args, ctx, tr) => {
      // 語が続く形は、未知の命令の誤りになる
      if (args.args !== '') return shown([err(tr('ui.terminal.unknown'))]);
      return changed(ctx, tr, { kind: 'gateway', gateway: null });
    },
  },
];
