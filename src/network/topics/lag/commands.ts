// リンクアグリゲーションの論点の命令。
import { lagBundlesOf } from '../../query/lagBundles';
import { changed, err, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { interfaceForm, portFirst } from '../../command/modes';
import { port } from '../../command/args';

const channelGroup: CommandSpec = {
  id: 'lag.channelGroup',
  modes: ['exec', 'config'],
  tokens: [{ word: 'channel-group' }, { rest: 'args' }],
  help: '',
  writes: true,
  topic: 'lag',
  run: (args, ctx, tr) => {
    const words = args.args.split(' ').filter((w) => w !== '');
    const lacp = words[2] === 'mode' && (words[3] === 'active' || words[3] === 'passive' || words[3] === 'on') ? words[3] : null;
    if (words.length !== 4 || port(words[0]) === null || !/^[0-9]+$/.test(words[1]) || lacp === null) return shown([err(tr('ui.terminal.usageChannel'))]);
    return changed(ctx, tr, { kind: 'channel', change: { port: Number(words[0]), group: Number(words[1]), lacp } });
  },
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'lag.showEtherchannelSummary',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'etherchannel' }, { word: 'summary' }],
    help: '',
    writes: false,
    topic: 'lag',
    run: (_args, ctx, tr) => {
      const { node } = ctx;
      // 設定のある口を、チャネルごとに出す。まとまった口に (P)、まとまらない口に (I)
      const configured = node.ports.filter((p) => p.channelGroup !== undefined).sort((a, b) => a.port - b.port);
      if (configured.length === 0) return shown([out(tr('ui.terminal.channelNone'))]);
      const bundled = new Set(lagBundlesOf(ctx.state, node.uid).flatMap((b) => b.links.flatMap((l) => [l.a, l.b])).filter((e) => e.node === node.uid).map((e) => e.port));
      return shown(
        [...new Set(configured.map((p) => p.channelGroup as number))].map((group) => {
          const ports = configured.filter((p) => p.channelGroup === group);
          const state = ports.some((p) => bundled.has(p.port)) ? 'P' : 'D';
          return out(tr('ui.terminal.channelLine', { group, state, lacp: ports[0].lacp ?? '', ports: ports.map((p) => `${p.port}(${bundled.has(p.port) ? 'P' : 'I'})`).join(' ') }));
        }),
      );
    },
  },
  channelGroup,
  interfaceForm(channelGroup, portFirst),
  {
    id: 'lag.noChannelGroup',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'channel-group' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'lag',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1 || port(words[0]) === null) return shown([err(tr('ui.terminal.usageChannel'))]);
      return changed(ctx, tr, { kind: 'channel', change: { port: Number(words[0]), group: null } });
    },
  },
];
