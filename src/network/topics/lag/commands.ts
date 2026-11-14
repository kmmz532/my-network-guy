// リンクアグリゲーションの論点の命令。
import { lagBundlesOf } from '../../query/lagBundles';
import { changed, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { interfaceOf } from '../../command/modes';

const PORT = { arg: 'number', name: 'port' } as const;

// channel-group <口> <番号> mode active|passive|on。LACP の形ごとに1つの命令にする（interface モードの形は口の番号を外す）
const LACP_MODES = ['active', 'passive', 'on'] as const;
const channelGroups: CommandSpec[] = LACP_MODES.map((lacp) => ({
  id: `lag.channelGroup${lacp[0].toUpperCase()}${lacp.slice(1)}`,
  modes: ['exec', 'config'],
  tokens: [{ word: 'channel-group' }, PORT, { arg: 'number', name: 'group' }, { word: 'mode' }, { word: lacp }],
  help: '',
  writes: true,
  topic: 'lag',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'channel', change: { port: Number(args.port), group: Number(args.group), lacp } }),
}));

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
  ...channelGroups,
  ...channelGroups.map((c) => interfaceOf(c)),
  {
    id: 'lag.noChannelGroup',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'channel-group' }, PORT],
    help: '',
    writes: true,
    topic: 'lag',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'channel', change: { port: Number(args.port), group: null } }),
  },
];
