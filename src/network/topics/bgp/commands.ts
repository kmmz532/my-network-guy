// BGP の論点の命令。
import { bgpTableOf } from '../../query/bgpTable';
import { changed, err, out, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec } from '../../command/types';
import type { Tr } from '../../terminal';
import { prefixOfMask } from '../../command/args';
import { enterRouter } from '../../command/modes';
import { getComponent } from '../../components';
import type { BgpOp } from '../../../sim/project';
import type { Token } from '../../command/types';

const showSummary = (_args: unknown, ctx: CommandContext, tr: Tr): CommandResult => {
  const bgp = bgpTableOf(ctx.state, ctx.node.uid);
  if (!bgp) return shown([err(tr('ui.terminal.bgpOff'))]);
  if (bgp.sessions.length === 0) return shown([out(tr('ui.terminal.bgpNone'))]);
  return shown(
    bgp.sessions.map((s) =>
      out(tr('ui.terminal.bgpSession', { ip: s.ip, as: s.remoteAs, kind: tr(s.ebgp ? 'ui.terminal.bgpEbgp' : 'ui.terminal.bgpIbgp'), state: s.status.state === 'established' ? tr('ui.terminal.bgpEstablished') : tr(`ui.terminal.bgpIdle.${s.status.reason}`) })),
    ),
  );
};

const showTable = (_args: unknown, ctx: CommandContext, tr: Tr): CommandResult => {
  const bgp = bgpTableOf(ctx.state, ctx.node.uid);
  if (!bgp) return shown([err(tr('ui.terminal.bgpOff'))]);
  const lines = bgp.candidates.map((c) =>
    out(tr('ui.terminal.bgpRoute', { mark: `${c.best ? '>' : ' '}${c.valid ? '*' : ' '}`, dest: c.dest, prefix: c.prefix, nextHop: c.nextHop ?? '0.0.0.0', lp: c.localPref, med: c.med, path: c.path.join(' ') || 'i' })),
  );
  return shown(lines.length > 0 ? [out(tr('ui.terminal.bgpHeader')), ...lines] : [out(tr('ui.terminal.bgpNone'))]);
};

// route-map モードの命令の共通の形。対象の項目がなければ誤りを返す
const editRouteMap = (ctx: CommandContext, tr: Tr, change: (name: string, seq: number) => BgpOp): CommandResult => {
  const { map, process: seq } = ctx.session;
  if (map === undefined || seq === null) throw new Error('route-map モードに対象がない');
  return changed(ctx, tr, { kind: 'bgp', change: change(map, seq) });
};

// set as-path prepend の AS 番号の最大の個数。命令の語の並びは固定の長さのため、個数ごとに命令を登録する
const MAX_PREPEND = 6;
const prependCommand = (count: number): CommandSpec => {
  const asns: Token[] = Array.from({ length: count }, (_, k) => ({ arg: 'asn', name: `as${k}` }));
  return {
    id: `bgp.setPrepend${count}`,
    modes: ['route-map'],
    tokens: [{ word: 'set' }, { word: 'as-path' }, { word: 'prepend' }, ...asns],
    help: 'ui.cmd.bgp.setPrepend',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => editRouteMap(ctx, tr, (name, seq) => ({ op: 'routeMapSet', name, seq, key: 'prepend', value: Array.from({ length: count }, (_, k) => Number(args[`as${k}`])) })),
  };
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'bgp.showIpBgpSummary',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'bgp' }, { word: 'summary' }],
    help: 'ui.cmd.bgp.showIpBgpSummary',
    writes: false,
    topic: 'bgp',
    run: showSummary,
  },
  {
    id: 'bgp.showIpBgp',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'bgp' }],
    help: 'ui.cmd.bgp.showIpBgp',
    writes: false,
    topic: 'bgp',
    run: showTable,
  },
  {
    id: 'bgp.network',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'network' }, { arg: 'ip', name: 'dest' }, { word: 'mask' }, { arg: 'mask', name: 'mask' }],
    help: 'ui.cmd.bgp.network',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'network', dest: args.dest, prefix: prefixOfMask(args.mask) } }),
  },
  {
    id: 'bgp.neighborNextHopSelf',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'next-hop-self' }],
    help: 'ui.cmd.bgp.neighborNextHopSelf',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'nextHopSelf', value: true } }),
  },
  {
    id: 'bgp.neighborLocalPref',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'local-preference' }, { arg: 'number', name: 'value' }],
    help: 'ui.cmd.bgp.neighborLocalPref',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'localPref', value: Number(args.value) } }),
  },
  {
    id: 'bgp.neighborMed',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'med' }, { arg: 'number', name: 'value' }],
    help: 'ui.cmd.bgp.neighborMed',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'med', value: Number(args.value) } }),
  },
  {
    id: 'bgp.neighborPrepend',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'prepend' }, { arg: 'number', name: 'value' }],
    help: 'ui.cmd.bgp.neighborPrepend',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'prepend', value: Number(args.value) } }),
  },
  {
    id: 'bgp.neighborRemoteAs',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'remote-as' }, { arg: 'asn', name: 'asn' }],
    help: 'ui.cmd.bgp.neighborRemoteAs',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'neighbor', ip: args.ip, remoteAs: Number(args.asn) } }),
  },
  {
    id: 'bgp.noNeighborNextHopSelf',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'no' }, { word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'next-hop-self' }],
    help: 'ui.cmd.bgp.noNeighborNextHopSelf',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'nextHopSelf', value: false } }),
  },
  {
    id: 'bgp.router',
    modes: ['exec', 'config'],
    tokens: [{ word: 'router' }, { word: 'bgp' }, { arg: 'asn', name: 'asn' }],
    help: 'ui.cmd.bgp.router',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => enterRouter(ctx, changed(ctx, tr, { kind: 'bgp', change: { op: 'asn', asn: Number(args.asn) } }), 'router-bgp', Number(args.asn)),
  },
  {
    id: 'bgp.routeMap',
    modes: ['exec', 'config'],
    tokens: [{ word: 'route-map' }, { arg: 'word', name: 'name' }, { word: 'permit' }, { arg: 'cost', name: 'seq' }],
    help: 'ui.cmd.bgp.routeMap',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => {
      const seq = Number(args.seq);
      const result = changed(ctx, tr, { kind: 'bgp', change: { op: 'routeMap', name: args.name, seq } });
      // 項目のモードへは、config から入るときだけ入る（exec の形はモードを変えない）
      return ctx.session.mode === 'config' && result.change !== null ? { ...result, session: { mode: 'route-map', iface: null, process: seq, map: args.name } } : result;
    },
  },
  {
    id: 'bgp.noRouteMap',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'route-map' }, { arg: 'word', name: 'name' }],
    help: 'ui.cmd.bgp.noRouteMap',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => {
      if (!(getComponent(ctx.node, 'bgp')?.routeMaps ?? []).some((m) => m.name === args.name)) return shown([err(tr('ui.error.bgp.no_route_map'))]);
      return changed(ctx, tr, { kind: 'bgp', change: { op: 'removeRouteMap', name: args.name } });
    },
  },
  {
    id: 'bgp.setLocalPref',
    modes: ['route-map'],
    tokens: [{ word: 'set' }, { word: 'local-preference' }, { arg: 'number', name: 'value' }],
    help: 'ui.cmd.bgp.setLocalPref',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => editRouteMap(ctx, tr, (name, seq) => ({ op: 'routeMapSet', name, seq, key: 'localPref', value: Number(args.value) })),
  },
  {
    id: 'bgp.setMetric',
    modes: ['route-map'],
    tokens: [{ word: 'set' }, { word: 'metric' }, { arg: 'number', name: 'value' }],
    help: 'ui.cmd.bgp.setMetric',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => editRouteMap(ctx, tr, (name, seq) => ({ op: 'routeMapSet', name, seq, key: 'med', value: Number(args.value) })),
  },
  ...Array.from({ length: MAX_PREPEND }, (_, k) => prependCommand(k + 1)),
  ...(['in', 'out'] as const).flatMap((dir): CommandSpec[] => [
    {
      id: `bgp.neighborRouteMap${dir}`,
      modes: ['exec', 'config', 'router-bgp'],
      tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'route-map' }, { arg: 'word', name: 'name' }, { word: dir }],
      help: 'ui.cmd.bgp.neighborRouteMap',
      writes: true,
      topic: 'bgp',
      run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'neighborRouteMap', ip: args.ip, dir, name: args.name } }),
    },
    {
      id: `bgp.noNeighborRouteMap${dir}`,
      modes: ['exec', 'config', 'router-bgp'],
      tokens: [{ word: 'no' }, { word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'route-map' }, { word: dir }],
      help: 'ui.cmd.bgp.noNeighborRouteMap',
      writes: true,
      topic: 'bgp',
      run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'neighborRouteMap', ip: args.ip, dir, name: null } }),
    },
  ]),
  {
    id: 'bgp.noRouter',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'router' }, { word: 'bgp' }],
    help: 'ui.cmd.bgp.noRouter',
    writes: true,
    topic: 'bgp',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'off' } }),
  },
];
