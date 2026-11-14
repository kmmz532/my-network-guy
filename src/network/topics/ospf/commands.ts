// OSPF の論点の命令。
import { ospfMismatchesOf } from '../../query/ospfMismatches';
import { ospfNeighborsOf } from '../../query/ospfNeighbors';
import { changed, err, nameOf, out, portMissing, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { areaOf, ifaceIdOf, isIp } from '../../command/args';
import { enterRouter, interfaceForm, wordsOf } from '../../command/modes';

const ipOspf: CommandSpec = {
  id: 'ospf.ipOspf',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'ospf' }, { rest: 'args' }],
  help: '',
  writes: true,
  topic: 'ospf',
  run: (args, ctx, tr) => {
    const words = args.args.split(' ').filter((w) => w !== '');
    const keys = { cost: 'cost', priority: 'priority', 'hello-interval': 'hello', 'dead-interval': 'dead' } as const;
    const key = keys[words[0] as keyof typeof keys];
    if (key === undefined || words.length !== 3 || !/^[0-9]+$/.test(words[1]) || !/^[0-9]+$/.test(words[2])) return shown([err(tr('ui.terminal.usageOspf'))]);
    const id = ifaceIdOf(ctx.node, Number(words[1]));
    if (id === null) return portMissing(ctx, tr);
    return changed(ctx, tr, { kind: 'ospf', change: { op: 'iface', id, key, value: Number(words[2]) } });
  },
};

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
  {
    id: 'ospf.routerId',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'router-id' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'ospf',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1 || !isIp(words[0])) return shown([err(tr('ui.terminal.usageOspf'))]);
      return changed(ctx, tr, { kind: 'ospf', change: { op: 'routerId', ip: words[0] } });
    },
  },
  {
    id: 'ospf.noRouterId',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'no' }, { word: 'router-id' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'ospf',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'ospf', change: { op: 'routerId', ip: null } }),
  },
  {
    id: 'ospf.defaultInformation',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'default-information' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'ospf',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1 || words[0] !== 'originate') return shown([err(tr('ui.terminal.usageOspf'))]);
      return changed(ctx, tr, { kind: 'ospf', change: { op: 'defaultOriginate', on: true } });
    },
  },
  {
    id: 'ospf.noDefaultInformation',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'no' }, { word: 'default-information' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'ospf',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1 || words[0] !== 'originate') return shown([err(tr('ui.terminal.usageOspf'))]);
      return changed(ctx, tr, { kind: 'ospf', change: { op: 'defaultOriginate', on: false } });
    },
  },
  ipOspf,
  interfaceForm(ipOspf, (words, p) => [words[0], String(p), ...words.slice(1)]),
  {
    id: 'ospf.network',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'network' }, { arg: 'ip', name: 'ip' }, { arg: 'wildcard', name: 'wildcard' }, { word: 'area' }, { arg: 'area', name: 'area' }],
    help: '',
    writes: true,
    topic: 'ospf',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'routing', change: { proto: 'ospf', ip: args.ip, area: areaOf(args.area), on: true } }),
  },
  {
    id: 'ospf.router',
    modes: ['exec', 'config'],
    tokens: [{ word: 'router' }, { word: 'ospf' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'ospf',
    // config のモードでは、番号（プロセス）を1つ書き、router-ospf のモードへ入る
    run: (args, ctx, tr) => {
      const words = wordsOf(args.args);
      if (ctx.session.mode === 'config' && (words.length !== 1 || !/^[0-9]+$/.test(words[0]))) return shown([err(tr('ui.terminal.usageOspf'))]);
      return enterRouter(ctx, changed(ctx, tr, { kind: 'routing', change: { proto: 'ospf', on: true } }), 'router-ospf', Number(words[0]));
    },
  },
  {
    id: 'ospf.noRouter',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'router' }, { word: 'ospf' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'ospf',
    run: (_args, ctx, tr) => {
      return changed(ctx, tr, { kind: 'routing', change: { proto: 'ospf', on: false } });
    },
  },
];
