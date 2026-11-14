// RIP の論点の命令。
import { learnedRoutesOf } from '../../query/learnedRoutes';
import { changed, err, out, shown } from '../../command/lines';
import type { CommandSpec, Mode } from '../../command/types';
import { isIp, maskToPrefix } from '../../command/args';
import { enterRouter } from '../../command/modes';

// router のモードごとの network の形
const ROUTER_FORM: Partial<Record<Mode, 'rip' | 'ospf' | 'bgp'>> = { 'router-rip': 'rip', 'router-ospf': 'ospf', 'router-bgp': 'bgp' };

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
    tokens: [{ word: 'router' }, { word: 'rip' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'rip',
    run: (_args, ctx, tr) => enterRouter(ctx, changed(ctx, tr, { kind: 'routing', change: { proto: 'rip', on: true } }), 'router-rip', null),
  },
  {
    id: 'rip.noRouter',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'router' }, { word: 'rip' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'rip',
    run: (_args, ctx, tr) => {
      return changed(ctx, tr, { kind: 'routing', change: { proto: 'rip', on: false } });
    },
  },
  {
    id: 'rip.network',
    modes: ['exec', 'config', 'router-rip', 'router-ospf', 'router-bgp'],
    tokens: [{ word: 'network' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'rip',
    // 形は3つ。BGP（IP mask マスク）→ RIP（IP）→ OSPF（IP ワイルドカード area エリア）の順に当てる。router のモードの中では、そのモードの形だけを受け付ける
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      const only = ROUTER_FORM[ctx.session.mode];
      if (words.length === 3 && words[1] === 'mask' && isIp(words[0]) && (only === undefined || only === 'bgp')) {
        const prefix = maskToPrefix(words[2]);
        if (prefix === null) return shown([err(tr('ui.terminal.errIp'))]);
        return changed(ctx, tr, { kind: 'bgp', change: { op: 'network', dest: words[0], prefix } });
      }
      if (words.length === 1 && isIp(words[0]) && (only === undefined || only === 'rip')) return changed(ctx, tr, { kind: 'routing', change: { proto: 'rip', ip: words[0], on: true } });
      if ((only === undefined || only === 'ospf') && words.length === 4 && isIp(words[0]) && isIp(words[1]) && words[2] === 'area' && (/^[0-9]+$/.test(words[3]) || isIp(words[3]))) {
        // エリアは整数と、試験の書き方の 0.0.0.0 の両方を受け付ける
        const area = isIp(words[3]) ? words[3].split('.').reduce((a, x) => a * 256 + Number(x), 0) : Number(words[3]);
        return changed(ctx, tr, { kind: 'routing', change: { proto: 'ospf', ip: words[0], area, on: true } });
      }
      return shown([err(tr('ui.terminal.usageNetwork'))]);
    },
  },
  {
    id: 'rip.noNetwork',
    modes: ['exec', 'config', 'router-rip'],
    tokens: [{ word: 'no' }, { word: 'network' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'rip',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length === 1 && isIp(words[0])) return changed(ctx, tr, { kind: 'routing', change: { proto: 'rip', ip: words[0], on: false } });
      return shown([err(tr('ui.terminal.unknown'))]);
    },
  },
];
