// QoS の論点の命令。口の出口の並べ方（priority-queue）と、スイッチの口のマーキングの信頼（mls qos trust dscp）。
import { changed } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { interfaceOf } from '../../command/modes';

const PORT = { arg: 'number', name: 'port' } as const;

// priority-queue <口>（interface モードの形は口の番号を外す）
const priorityQueue: CommandSpec = {
  id: 'qos.priorityQueue',
  modes: ['exec', 'config'],
  tokens: [{ word: 'priority-queue' }, PORT],
  help: 'ui.cmd.qos.priorityQueue',
  writes: true,
  topic: 'qos',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'portQos', port: Number(args.port), change: { qos: 'priority' } }),
};

const noPriorityQueue: CommandSpec = {
  id: 'qos.noPriorityQueue',
  modes: ['exec', 'config'],
  tokens: [{ word: 'no' }, { word: 'priority-queue' }, PORT],
  help: 'ui.cmd.qos.noPriorityQueue',
  writes: true,
  topic: 'qos',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'portQos', port: Number(args.port), change: { qos: 'none' } }),
};

// mls qos <口> trust dscp
const trustDscp: CommandSpec = {
  id: 'qos.mlsQosTrustDscp',
  modes: ['exec', 'config'],
  tokens: [{ word: 'mls' }, { word: 'qos' }, PORT, { word: 'trust' }, { word: 'dscp' }],
  help: 'ui.cmd.qos.mlsQosTrustDscp',
  writes: true,
  topic: 'qos',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'portQos', port: Number(args.port), change: { trust: true } }),
};

const noTrust: CommandSpec = {
  id: 'qos.noMlsQosTrust',
  modes: ['exec', 'config'],
  tokens: [{ word: 'no' }, { word: 'mls' }, { word: 'qos' }, PORT, { word: 'trust' }],
  help: 'ui.cmd.qos.noMlsQosTrust',
  writes: true,
  topic: 'qos',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'portQos', port: Number(args.port), change: { trust: false } }),
};

export const commands: readonly CommandSpec[] = [priorityQueue, interfaceOf(priorityQueue), noPriorityQueue, interfaceOf(noPriorityQueue), trustDscp, interfaceOf(trustDscp), noTrust, interfaceOf(noTrust)];
