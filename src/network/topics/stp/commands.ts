// スパニングツリーの論点の命令。
import { stpOf } from '../../query/stp';
import { changed, err, nameOf, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { port } from '../../terminalConfig';

export const commands: readonly CommandSpec[] = [
  {
    id: 'stp.showSpanningTree',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'spanning-tree' }],
    help: '',
    writes: false,
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
  {
    id: 'stp.spanningTree',
    modes: ['exec'],
    tokens: [{ word: 'spanning-tree' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'stp',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words[0] === 'priority' && words.length === 2 && /^[0-9]+$/.test(words[1])) {
        const v = Number(words[1]);
        if (v > 61440 || v % 4096 !== 0) return shown([err(tr('ui.terminal.errStpPriority'))]);
        return changed(ctx, tr, { kind: 'stp', change: { op: 'priority', value: v } });
      }
      if (words[0] === 'cost' && words.length === 3 && port(words[1]) !== null && /^[0-9]+$/.test(words[2]) && Number(words[2]) >= 1) {
        return changed(ctx, tr, { kind: 'stp', change: { op: 'cost', port: Number(words[1]), value: Number(words[2]) } });
      }
      return shown([err(tr('ui.terminal.usageStp'))]);
    },
  },
];
