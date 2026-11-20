// OSPF の論点の命令。
import { ospfMismatchesOf } from '../../query/ospfMismatches';
import { ospfNeighborsOf } from '../../query/ospfNeighbors';
import { changed, err, nameOf, out, portMissing, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { getComponent } from '../../components';
import { areaOf, ifaceIdOf, ifaceLabel } from '../../command/args';
import { enterRouter, interfaceOf } from '../../command/modes';

const PORT = { arg: 'number', name: 'port' } as const;

// ip ospf cost・priority・hello-interval・dead-interval <口> <値>。口と値は番号
const ipOspfKeys = [
  { word: 'cost', key: 'cost', id: 'Cost' },
  { word: 'priority', key: 'priority', id: 'Priority' },
  { word: 'hello-interval', key: 'hello', id: 'Hello' },
  { word: 'dead-interval', key: 'dead', id: 'Dead' },
] as const;

const ipOspf: CommandSpec[] = ipOspfKeys.map(({ word, key, id }) => ({
  id: `ospf.ipOspf${id}`,
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'ospf' }, { word }, PORT, { arg: 'number', name: 'value' }],
  help: `ui.cmd.ospf.ipOspf${id}`,
  writes: true,
  topic: 'ospf',
  run: (args, ctx, tr) => {
    const ifaceId = ifaceIdOf(ctx.node, Number(args.port));
    if (ifaceId === null) return portMissing(ctx, tr);
    return changed(ctx, tr, { kind: 'ospf', change: { op: 'iface', id: ifaceId, key, value: Number(args.value) } });
  },
}));

export const commands: readonly CommandSpec[] = [
  {
    id: 'ospf.showIpOspfNeighbor',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'ospf' }, { word: 'neighbor' }],
    help: 'ui.cmd.ospf.showIpOspfNeighbor',
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
    id: 'ospf.showIpOspfInterface',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'ospf' }, { word: 'interface' }],
    help: 'ui.cmd.ospf.showIpOspfInterface',
    writes: false,
    topic: 'ospf',
    run: (_args, ctx, tr) => {
      const joined = ctx.node.interfaces.filter((i) => i.ospf !== undefined);
      if (joined.length === 0) return shown([out(tr('ui.terminal.ospfInterfaceNone'))]);
      // コストは、経路の計算と同じ値（口の設定、なければ速さから）
      return shown(joined.map((i) => out(tr('ui.terminal.ospfInterface', { name: ifaceLabel(i, tr), ip: i.ip, prefix: i.prefix, area: i.ospf!.area, cost: ctx.state.routing.ospfCostOf(ctx.node.uid, i.port) }))));
    },
  },
  {
    id: 'ospf.routerId',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'router-id' }, { arg: 'ip', name: 'ip' }],
    help: 'ui.cmd.ospf.routerId',
    writes: true,
    topic: 'ospf',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'ospf', change: { op: 'routerId', ip: args.ip } }),
  },
  {
    id: 'ospf.noRouterId',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'no' }, { word: 'router-id' }],
    help: 'ui.cmd.ospf.noRouterId',
    writes: true,
    topic: 'ospf',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'ospf', change: { op: 'routerId', ip: null } }),
  },
  {
    id: 'ospf.defaultInformation',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'default-information' }, { word: 'originate' }],
    help: 'ui.cmd.ospf.defaultInformation',
    writes: true,
    topic: 'ospf',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'ospf', change: { op: 'defaultOriginate', on: true } }),
  },
  {
    id: 'ospf.noDefaultInformation',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'no' }, { word: 'default-information' }, { word: 'originate' }],
    help: 'ui.cmd.ospf.noDefaultInformation',
    writes: true,
    topic: 'ospf',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'ospf', change: { op: 'defaultOriginate', on: false } }),
  },
  {
    id: 'ospf.autoCostReferenceBandwidth',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'auto-cost' }, { word: 'reference-bandwidth' }, { arg: 'cost', name: 'mbps' }],
    help: 'ui.cmd.ospf.autoCostReferenceBandwidth',
    writes: true,
    topic: 'ospf',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'ospf', change: { op: 'referenceBandwidth', mbps: Number(args.mbps) } }),
  },
  {
    id: 'ospf.noAutoCostReferenceBandwidth',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'no' }, { word: 'auto-cost' }, { word: 'reference-bandwidth' }],
    help: 'ui.cmd.ospf.noAutoCostReferenceBandwidth',
    writes: true,
    topic: 'ospf',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'ospf', change: { op: 'referenceBandwidth', mbps: null } }),
  },
  ...ipOspf,
  ...ipOspf.map((s) => interfaceOf(s)),
  {
    id: 'ospf.network',
    modes: ['exec', 'config', 'router-ospf'],
    tokens: [{ word: 'network' }, { arg: 'ip', name: 'ip' }, { arg: 'wildcard', name: 'wildcard' }, { word: 'area' }, { arg: 'area', name: 'area' }],
    help: 'ui.cmd.ospf.network',
    writes: true,
    topic: 'ospf',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'routing', change: { proto: 'ospf', ip: args.ip, wildcard: args.wildcard, area: areaOf(args.area), on: true } }),
  },
  {
    id: 'ospf.router',
    modes: ['exec'],
    tokens: [{ word: 'router' }, { word: 'ospf' }],
    help: 'ui.cmd.ospf.router',
    writes: true,
    topic: 'ospf',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'routing', change: { proto: 'ospf', on: true } }),
  },
  {
    id: 'ospf.routerProcess',
    modes: ['exec', 'config'],
    tokens: [{ word: 'router' }, { word: 'ospf' }, { arg: 'number', name: 'process' }],
    help: 'ui.cmd.ospf.routerProcess',
    writes: true,
    topic: 'ospf',
    // config のモードでは、番号（プロセス）を書いて router-ospf のモードへ入る。exec の形はモードを変えない
    run: (args, ctx, tr) => enterRouter(ctx, changed(ctx, tr, { kind: 'routing', change: { proto: 'ospf', on: true, process: Number(args.process) } }), 'router-ospf', Number(args.process)),
  },
  {
    id: 'ospf.noRouter',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'router' }, { word: 'ospf' }],
    help: 'ui.cmd.ospf.noRouter',
    writes: true,
    topic: 'ospf',
    // 番号を書かない形は、番号（process）も外す
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'routing', change: { proto: 'ospf', on: false, process: null } }),
  },
  {
    id: 'ospf.noRouterProcess',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'router' }, { word: 'ospf' }, { arg: 'number', name: 'process' }],
    help: 'ui.cmd.ospf.noRouterProcess',
    writes: true,
    topic: 'ospf',
    run: (args, ctx, tr) => {
      // 番号が書いてあり、違うときは外さない（読み取り専用の拒否の後に、中身の検査をする）
      const process = getComponent(ctx.node, 'ospf')?.process;
      if (process !== undefined && process !== Number(args.process) && !ctx.readOnly) return shown([err(tr('ui.terminal.ospfProcessMismatch', { process }))]);
      return changed(ctx, tr, { kind: 'routing', change: { proto: 'ospf', on: false, process: null } });
    },
  },
];
