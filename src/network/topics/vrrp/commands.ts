// VRRP の論点の命令。
import { vrrpStatusOf } from '../../query/vrrpStatus';
import { changed, out, portMissing, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { interfaceOf } from '../../command/modes';
import { ifaceIdOf } from '../../command/args';

const PORT = { arg: 'number', name: 'port' } as const;
const VRID = { arg: 'vrid', name: 'vrid' } as const;

// 口ごとの VRRP の命令の形（exec・config）。interface モードの形は、口の番号を外して作る
const vrrpIp: CommandSpec = {
  id: 'vrrp.vrrpIp',
  modes: ['exec', 'config'],
  tokens: [{ word: 'vrrp' }, PORT, VRID, { word: 'ip' }, { arg: 'ip', name: 'ip' }],
  help: '',
  writes: true,
  topic: 'vrrp',
  run: (args, ctx, tr) => {
    const id = ifaceIdOf(ctx.node, Number(args.port));
    if (id === null) return portMissing(ctx, tr);
    return changed(ctx, tr, { kind: 'vrrp', change: { op: 'ip', id, vrid: Number(args.vrid), ip: args.ip } });
  },
};

const vrrpPriority: CommandSpec = {
  id: 'vrrp.vrrpPriority',
  modes: ['exec', 'config'],
  tokens: [{ word: 'vrrp' }, PORT, VRID, { word: 'priority' }, { arg: 'number', name: 'value' }],
  help: '',
  writes: true,
  topic: 'vrrp',
  run: (args, ctx, tr) => {
    const id = ifaceIdOf(ctx.node, Number(args.port));
    if (id === null) return portMissing(ctx, tr);
    return changed(ctx, tr, { kind: 'vrrp', change: { op: 'priority', id, vrid: Number(args.vrid), value: Number(args.value) } });
  },
};

const vrrpPreempt: CommandSpec = {
  id: 'vrrp.vrrpPreempt',
  modes: ['exec', 'config'],
  tokens: [{ word: 'vrrp' }, PORT, VRID, { word: 'preempt' }],
  help: '',
  writes: true,
  topic: 'vrrp',
  run: (args, ctx, tr) => {
    const id = ifaceIdOf(ctx.node, Number(args.port));
    if (id === null) return portMissing(ctx, tr);
    return changed(ctx, tr, { kind: 'vrrp', change: { op: 'preempt', id, vrid: Number(args.vrid), on: true } });
  },
};

const vrrpTrack: CommandSpec = {
  id: 'vrrp.vrrpTrack',
  modes: ['exec', 'config'],
  tokens: [{ word: 'vrrp' }, PORT, VRID, { word: 'track' }, { arg: 'number', name: 'track' }, { word: 'decrement' }, { arg: 'number', name: 'value' }],
  help: '',
  writes: true,
  topic: 'vrrp',
  run: (args, ctx, tr) => {
    const id = ifaceIdOf(ctx.node, Number(args.port));
    if (id === null) return portMissing(ctx, tr);
    const trackId = ifaceIdOf(ctx.node, Number(args.track));
    if (trackId === null) return portMissing(ctx, tr);
    return changed(ctx, tr, { kind: 'vrrp', change: { op: 'track', id, vrid: Number(args.vrid), iface: trackId, decrement: Number(args.value) } });
  },
};

const noVrrp: CommandSpec = {
  id: 'vrrp.noVrrp',
  modes: ['exec', 'config'],
  tokens: [{ word: 'no' }, { word: 'vrrp' }, PORT, VRID],
  help: '',
  writes: true,
  topic: 'vrrp',
  run: (args, ctx, tr) => {
    const id = ifaceIdOf(ctx.node, Number(args.port));
    if (id === null) return portMissing(ctx, tr);
    return changed(ctx, tr, { kind: 'vrrp', change: { op: 'remove', id, vrid: Number(args.vrid) } });
  },
};

const noVrrpPreempt: CommandSpec = {
  id: 'vrrp.noVrrpPreempt',
  modes: ['exec', 'config'],
  tokens: [{ word: 'no' }, { word: 'vrrp' }, PORT, VRID, { word: 'preempt' }],
  help: '',
  writes: true,
  topic: 'vrrp',
  run: (args, ctx, tr) => {
    const id = ifaceIdOf(ctx.node, Number(args.port));
    if (id === null) return portMissing(ctx, tr);
    return changed(ctx, tr, { kind: 'vrrp', change: { op: 'preempt', id, vrid: Number(args.vrid), on: false } });
  },
};

const vrrpForms = [vrrpIp, vrrpPriority, vrrpPreempt, vrrpTrack];

export const commands: readonly CommandSpec[] = [
  {
    id: 'vrrp.showVrrp',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'vrrp' }],
    help: '',
    writes: false,
    topic: 'vrrp',
    run: (_args, ctx, tr) => {
      const groups = vrrpStatusOf(ctx.state, ctx.node.uid);
      if (groups.length === 0) return shown([out(tr('ui.terminal.vrrpNone'))]);
      return shown(groups.map((g) => out(tr('ui.terminal.vrrpGroup', { iface: g.iface, vrid: g.vrid, state: g.state, ip: g.ip, priority: g.priority, preempt: tr(g.preempt ? 'ui.terminal.vrrpPreemptOn' : 'ui.terminal.vrrpPreemptOff') }))));
    },
  },
  ...vrrpForms,
  ...vrrpForms.map((s) => interfaceOf(s)),
  noVrrp,
  noVrrpPreempt,
];
