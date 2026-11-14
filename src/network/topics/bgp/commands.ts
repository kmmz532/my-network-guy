// BGP の論点の命令。
import { bgpTableOf } from '../../query/bgpTable';
import { changed, err, out, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec } from '../../command/types';
import type { Tr } from '../../terminal';
import { prefixOfMask } from '../../command/args';
import { enterRouter } from '../../command/modes';

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

export const commands: readonly CommandSpec[] = [
  {
    id: 'bgp.showIpBgpSummary',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'bgp' }, { word: 'summary' }],
    help: '',
    writes: false,
    topic: 'bgp',
    run: showSummary,
  },
  {
    id: 'bgp.showIpBgp',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'bgp' }],
    help: '',
    writes: false,
    topic: 'bgp',
    run: showTable,
  },
  {
    id: 'bgp.network',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'network' }, { arg: 'ip', name: 'dest' }, { word: 'mask' }, { arg: 'mask', name: 'mask' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'network', dest: args.dest, prefix: prefixOfMask(args.mask) } }),
  },
  {
    id: 'bgp.neighborNextHopSelf',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'next-hop-self' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'nextHopSelf', value: true } }),
  },
  {
    id: 'bgp.neighborLocalPref',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'local-preference' }, { arg: 'number', name: 'value' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'localPref', value: Number(args.value) } }),
  },
  {
    id: 'bgp.neighborMed',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'med' }, { arg: 'number', name: 'value' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'med', value: Number(args.value) } }),
  },
  {
    id: 'bgp.neighborPrepend',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'prepend' }, { arg: 'number', name: 'value' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'prepend', value: Number(args.value) } }),
  },
  {
    id: 'bgp.neighborRemoteAs',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'remote-as' }, { arg: 'asn', name: 'asn' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'neighbor', ip: args.ip, remoteAs: Number(args.asn) } }),
  },
  {
    id: 'bgp.noNeighborNextHopSelf',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'no' }, { word: 'neighbor' }, { arg: 'ip', name: 'ip' }, { word: 'next-hop-self' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: args.ip, key: 'nextHopSelf', value: false } }),
  },
  {
    id: 'bgp.router',
    modes: ['exec', 'config'],
    tokens: [{ word: 'router' }, { word: 'bgp' }, { arg: 'asn', name: 'asn' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => enterRouter(ctx, changed(ctx, tr, { kind: 'bgp', change: { op: 'asn', asn: Number(args.asn) } }), 'router-bgp', Number(args.asn)),
  },
  {
    id: 'bgp.noRouter',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'router' }, { word: 'bgp' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'bgp', change: { op: 'off' } }),
  },
];
