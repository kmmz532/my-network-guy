// リンクアグリゲーションの論点の命令。
import { lagBundlesOf } from '../../query/lagBundles';
import { out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'lag.showEtherchannelSummary',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'etherchannel' }, { word: 'summary' }],
    help: '',
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
];
