// スパニングツリーの論点の命令。
import { stpOf } from '../../query/stp';
import { err, nameOf, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'stp.showSpanningTree',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'spanning-tree' }],
    help: '',
    topic: 'stp',
    run: (_args, ctx, tr) => {
      const { node } = ctx;
      const stp = stpOf(ctx.state);
      if (stp.root === null || !stp.rootCost.has(node.uid)) return shown([err(tr('ui.terminal.stpOff'))]);
      const lines = [out(tr(stp.root === node.uid ? 'ui.terminal.stpIsRoot' : 'ui.terminal.stpRoot', { root: nameOf(ctx, ctx.nodes.find((n) => n.uid === stp.root) ?? node), cost: stp.rootCost.get(node.uid) ?? 0 }))];
      const mine = [...stp.roles.entries()].filter(([k]) => k.startsWith(`${node.uid}:`)).map(([k, role]) => ({ port: Number(k.split(':')[1]), role })).sort((a, b) => a.port - b.port);
      for (const p of mine) lines.push(out(tr(`ui.terminal.stpPort.${p.role}`, { port: p.port })));
      return shown(lines);
    },
  },
];
