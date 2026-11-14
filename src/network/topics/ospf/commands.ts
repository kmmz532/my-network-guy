// OSPF の論点の命令。
import { ospfMismatchesOf } from '../../query/ospfMismatches';
import { ospfNeighborsOf } from '../../query/ospfNeighbors';
import { nameOf, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'ospf.showIpOspfNeighbor',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'ospf' }, { word: 'neighbor' }],
    help: '',
    writes: false,
    topic: 'ospf',
    run: (_args, ctx, tr) => {
      const { node } = ctx;
      const neighbors = ospfNeighborsOf(ctx.state, node.uid);
      const nameOfUid = (uid: string) => nameOf(ctx, ctx.nodes.find((n) => n.uid === uid) ?? node);
      if (neighbors.length === 0) {
        // 隣接がないときは、条件が合わなかった相手と理由を出す
        const mismatches = ospfMismatchesOf(ctx.state, node.uid);
        if (mismatches.length === 0) return shown([out(tr('ui.terminal.ospfNone'))]);
        return shown(mismatches.map((m) => out(tr('ui.terminal.ospfMismatch', { name: nameOfUid(m.uid), ip: m.neighborIp, reason: tr(`ui.terminal.ospfMismatch.${m.mismatch}`) }))));
      }
      return shown(neighbors.map((nb) => out(tr('ui.terminal.ospfNeighbor', { name: nameOfUid(nb.uid), ip: nb.neighborIp, port: nb.port, routerId: nb.routerId, priority: nb.priority, state: nb.state }))));
    },
  },
];
