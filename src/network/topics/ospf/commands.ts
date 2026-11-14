// OSPF の論点の命令。
import { ospfMismatchesOf } from '../../query/ospfMismatches';
import { ospfNeighborsOf } from '../../query/ospfNeighbors';
import { changed, err, nameOf, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { isIp } from '../../terminalConfig';

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
    modes: ['exec'],
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
    modes: ['exec'],
    tokens: [{ word: 'no' }, { word: 'router-id' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'ospf',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'ospf', change: { op: 'routerId', ip: null } }),
  },
  {
    id: 'ospf.defaultInformation',
    modes: ['exec'],
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
    modes: ['exec'],
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
  {
    id: 'ospf.ipOspf',
    modes: ['exec'],
    tokens: [{ word: 'ip' }, { word: 'ospf' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'ospf',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      const keys = { cost: 'cost', priority: 'priority', 'hello-interval': 'hello', 'dead-interval': 'dead' } as const;
      const key = keys[words[0] as keyof typeof keys];
      if (key === undefined || words.length !== 3 || !/^[0-9]+$/.test(words[1]) || !/^[0-9]+$/.test(words[2])) return shown([err(tr('ui.terminal.usageOspf'))]);
      // 口の番号からインターフェースの id を引く（今の legacyChange と同じ）
      const id = ctx.node.interfaces.find((i) => i.port === Number(words[1]))?.id ?? '';
      return changed(ctx, tr, { kind: 'ospf', change: { op: 'iface', id, key, value: Number(words[2]) } });
    },
  },
];
