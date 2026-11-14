// BGP の論点の命令。
import { bgpTableOf } from '../../query/bgpTable';
import { err, out, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec } from '../../command/types';
import type { Tr } from '../../terminal';

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
];
