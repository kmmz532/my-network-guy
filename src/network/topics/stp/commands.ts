// スパニングツリーの論点の命令。
import { stpOf } from '../../query/stp';
import { changed, err, nameOf, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { interfaceOf } from '../../command/modes';

const PORT = { arg: 'number', name: 'port' } as const;

// spanning-tree priority <値>。値の範囲（61440 以下・4096 の倍数）は run が検査する
const stpPriority: CommandSpec = {
  id: 'stp.spanningTreePriority',
  modes: ['exec', 'config'],
  tokens: [{ word: 'spanning-tree' }, { word: 'priority' }, { arg: 'number', name: 'value' }],
  help: '',
  writes: true,
  topic: 'stp',
  run: (args, ctx, tr) => {
    const v = Number(args.value);
    if (v > 61440 || v % 4096 !== 0) return shown([err(tr('ui.terminal.errStpPriority'))]);
    return changed(ctx, tr, { kind: 'stp', change: { op: 'priority', value: v } });
  },
};

// spanning-tree cost <口> <値>（interface モードの形は口の番号を外す）
const stpCost: CommandSpec = {
  id: 'stp.spanningTreeCost',
  modes: ['exec', 'config'],
  tokens: [{ word: 'spanning-tree' }, { word: 'cost' }, PORT, { arg: 'cost', name: 'value' }],
  help: '',
  writes: true,
  topic: 'stp',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'stp', change: { op: 'cost', port: Number(args.port), value: Number(args.value) } }),
};

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
  stpPriority,
  interfaceOf(stpPriority),
  stpCost,
  interfaceOf(stpCost),
];
