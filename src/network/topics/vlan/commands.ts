// VLAN の論点の命令。
import { macTableOf } from '../../query/macTable';
import { deviceCategory } from '../../../registry/query';
import { changed, err, out, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec } from '../../command/types';
import type { Tr } from '../../terminal';
import { interfaceOf, sessionPortOf } from '../../command/modes';

// スイッチの MAC の表は、同じ L2 のドメインの端末から求める。端末では使えない
const showMacAddressTable = (_args: unknown, ctx: CommandContext, tr: Tr): CommandResult => {
  const { node } = ctx;
  if (deviceCategory(node.device) !== 'l2_switch') return shown([err(tr('ui.terminal.noMacTable'))]);
  const entries = macTableOf(ctx.state, node.uid);
  if (entries.length === 0) return shown([out(tr('ui.terminal.macNone'))]);
  return shown(entries.map((e) => out(tr('ui.terminal.macEntry', { port: e.port, mac: e.mac }))));
};

// 口ごとの VLAN の設定（設定のない口は既定の VLAN 1）
const showVlan = (_args: unknown, { node }: CommandContext, tr: Tr): CommandResult => {
  const cfgs = [...node.ports].sort((a, b) => a.port - b.port);
  if (cfgs.length === 0) return shown([out(tr('ui.terminal.vlanNone'))]);
  return shown(
    cfgs.map((c) =>
      out(
        c.mode === 'access'
          ? tr('ui.terminal.vlanAccess', { port: c.port, vlan: c.vlan ?? 1 })
          : c.mode === 'trunk'
            ? tr('ui.terminal.vlanTrunk', { port: c.port, allowed: c.allowed === undefined ? tr('ui.terminal.vlanAll') : c.allowed.join(','), native: c.native ?? 1 })
            : tr('ui.terminal.vlanRouted', { port: c.port }),
      ),
    ),
  );
};

const PORT = { arg: 'number', name: 'port' } as const;

// 口を access にし、VLAN に入れる（switchport <口> access vlan <番号>）。trunk の命令は trunk の論点
const switchportAccess: CommandSpec = {
  id: 'vlan.switchportAccess',
  modes: ['exec', 'config'],
  tokens: [{ word: 'switchport' }, PORT, { word: 'access' }, { word: 'vlan' }, { arg: 'vlan', name: 'vlan' }],
  help: '',
  writes: true,
  topic: 'vlan',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'portMode', port: Number(args.port), mode: { kind: 'access', vlan: Number(args.vlan) } }),
};

// interface モードの mode access: access は今の VLAN（なければ VLAN 1）のまま、モードだけ替える
const switchportModeAccess: CommandSpec = {
  id: 'vlan.switchportModeAccess',
  modes: ['interface'],
  tokens: [{ word: 'switchport' }, { word: 'mode' }, { word: 'access' }],
  help: '',
  writes: true,
  topic: 'vlan',
  run: (_args, ctx, tr) => {
    const port = sessionPortOf(ctx);
    if (port === null) return shown([err(tr('ui.terminal.errIfaceKind'))]);
    const current = ctx.node.ports.find((c) => c.port === port);
    return changed(ctx, tr, { kind: 'portMode', port, mode: { kind: 'access', vlan: current?.mode === 'access' ? (current.vlan ?? 1) : 1 } });
  },
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'vlan.showMacAddressTable',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'mac' }, { word: 'address-table' }],
    help: '',
    writes: false,
    topic: 'vlan',
    run: showMacAddressTable,
  },
  {
    id: 'vlan.showVlanBrief',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'vlan' }, { word: 'brief' }],
    help: '',
    writes: false,
    topic: 'vlan',
    run: showVlan,
  },
  {
    id: 'vlan.showVlan',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'vlan' }],
    help: '',
    writes: false,
    topic: 'vlan',
    run: showVlan,
  },
  switchportAccess,
  interfaceOf(switchportAccess),
  switchportModeAccess,
  {
    id: 'vlan.noSwitchport',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'switchport' }, PORT],
    help: '',
    writes: true,
    topic: 'vlan',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'portMode', port: Number(args.port), mode: { kind: 'routed' } }),
  },
];
