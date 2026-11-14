// BGP の論点の命令。
import { bgpTableOf } from '../../query/bgpTable';
import { changed, err, out, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec } from '../../command/types';
import type { Tr } from '../../terminal';
import { isIp } from '../../command/args';
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
    id: 'bgp.neighbor',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'neighbor' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'bgp',
    // 形は3つ。next-hop-self → 属性（local-preference・med・prepend の値）→ remote-as の順に当てる
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (isIp(words[0] ?? '') && words[1] === 'next-hop-self' && words.length === 2) return changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: words[0], key: 'nextHopSelf', value: true } });
      if (isIp(words[0] ?? '') && words.length === 3 && /^[0-9]+$/.test(words[2])) {
        const keys = { 'local-preference': 'localPref', med: 'med', prepend: 'prepend' } as const;
        const key = keys[words[1] as keyof typeof keys];
        if (key !== undefined) return changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: words[0], key, value: Number(words[2]) } });
      }
      if (words.length !== 3 || words[1] !== 'remote-as' || !isIp(words[0]) || !/^[0-9]+$/.test(words[2])) return shown([err(tr('ui.terminal.usageBgp'))]);
      return changed(ctx, tr, { kind: 'bgp', change: { op: 'neighbor', ip: words[0], remoteAs: Number(words[2]) } });
    },
  },
  {
    id: 'bgp.noNeighbor',
    modes: ['exec', 'config', 'router-bgp'],
    tokens: [{ word: 'no' }, { word: 'neighbor' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (isIp(words[0] ?? '') && words[1] === 'next-hop-self' && words.length === 2) return changed(ctx, tr, { kind: 'bgp', change: { op: 'attr', ip: words[0], key: 'nextHopSelf', value: false } });
      return shown([err(tr('ui.terminal.unknown'))]);
    },
  },
  {
    id: 'bgp.router',
    modes: ['exec', 'config'],
    tokens: [{ word: 'router' }, { word: 'bgp' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (args, ctx, tr) => {
      const [asn] = args.args.split(' ').filter((w) => w !== '');
      if (!/^[0-9]+$/.test(asn ?? '')) return shown([err(tr('ui.terminal.usageBgp'))]);
      return enterRouter(ctx, changed(ctx, tr, { kind: 'bgp', change: { op: 'asn', asn: Number(asn) } }), 'router-bgp', Number(asn));
    },
  },
  {
    id: 'bgp.noRouter',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'router' }, { word: 'bgp' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'bgp',
    run: (_args, ctx, tr) => {
      return changed(ctx, tr, { kind: 'bgp', change: { op: 'off' } });
    },
  },
];
