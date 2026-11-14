// VLAN の論点の命令。
import { macTableOf } from '../../query/macTable';
import { deviceCategory } from '../../../registry/query';
import { changed, err, out, shown } from '../../command/lines';
import type { CommandContext, CommandResult, CommandSpec } from '../../command/types';
import type { Tr } from '../../terminal';
import { port, vlanNumber } from '../../command/args';
import { interfaceForm, sessionPortOf, wordsOf } from '../../command/modes';

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

const switchport: CommandSpec = {
  id: 'vlan.switchport',
  modes: ['exec', 'config'],
  tokens: [{ word: 'switchport' }, { rest: 'args' }],
  help: '',
  writes: true,
  topic: 'vlan',
  // 形は2つ。trunk（口 trunk …）→ access（口 access vlan 番号）の順に当てる
  run: (args, ctx, tr) => {
    const words = args.args.split(' ').filter((w) => w !== '');
    if (words[1] === 'trunk') {
      const p = port(words[0]);
      if (p === null) return shown([err(tr('ui.terminal.errPort'))]);
      const mode: { kind: 'trunk'; allowed?: number[] | null; native?: number } = { kind: 'trunk' };
      let i = 2;
      while (i < words.length) {
        if (words[i] === 'allowed' && words[i + 1] !== undefined) {
          if (words[i + 1] === 'all') mode.allowed = null;
          else {
            const list = words[i + 1].split(',').map(vlanNumber);
            if (list.some((v) => v === null)) return shown([err(tr('ui.terminal.errVlan'))]);
            mode.allowed = list as number[];
          }
          i += 2;
        } else if (words[i] === 'native' && words[i + 1] !== undefined) {
          const v = vlanNumber(words[i + 1]);
          if (v === null) return shown([err(tr('ui.terminal.errVlan'))]);
          mode.native = v;
          i += 2;
        } else return shown([err(tr('ui.terminal.usageSwitchport'))]);
      }
      return changed(ctx, tr, { kind: 'portMode', port: p, mode });
    }
    if (words.length !== 4 || words[1] !== 'access' || words[2] !== 'vlan') return shown([err(tr('ui.terminal.usageSwitchport'))]);
    const p = port(words[0]);
    if (p === null) return shown([err(tr('ui.terminal.errPort'))]);
    const v = vlanNumber(words[3]);
    if (v === null) return shown([err(tr('ui.terminal.errVlan'))]);
    return changed(ctx, tr, { kind: 'portMode', port: p, mode: { kind: 'access', vlan: v } });
  },
};

// interface モードの形: mode access|trunk・access vlan <n>・trunk allowed vlan <一覧>・trunk native vlan <n>
const switchportForm = interfaceForm(switchport, (words, p) => {
  if (words[0] === 'trunk' && words[1] === 'allowed' && words[2] === 'vlan') return [String(p), 'trunk', 'allowed', ...words.slice(3)];
  if (words[0] === 'trunk' && words[1] === 'native' && words[2] === 'vlan') return [String(p), 'trunk', 'native', ...words.slice(3)];
  return [String(p), ...words];
});
const switchportInterface: CommandSpec = {
  ...switchportForm,
  run: (args, ctx, tr) => {
    const words = wordsOf(args.args);
    if (words.length === 2 && words[0] === 'mode' && (words[1] === 'access' || words[1] === 'trunk')) {
      const p = sessionPortOf(ctx);
      if (p === null) return shown([err(tr('ui.terminal.errIfaceKind'))]);
      // access は今の VLAN（なければ VLAN 1）のまま、trunk は今の許可・native のまま、モードだけ替える
      const current = ctx.node.ports.find((c) => c.port === p);
      return changed(ctx, tr, { kind: 'portMode', port: p, mode: words[1] === 'trunk' ? { kind: 'trunk' } : { kind: 'access', vlan: current?.mode === 'access' ? (current.vlan ?? 1) : 1 } });
    }
    return switchportForm.run(args, ctx, tr);
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
  switchport,
  switchportInterface,
  {
    id: 'vlan.noSwitchport',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'switchport' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'vlan',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words.length !== 1) return shown([err(tr('ui.terminal.usageSwitchport'))]);
      const p = port(words[0]);
      if (p === null) return shown([err(tr('ui.terminal.errPort'))]);
      return changed(ctx, tr, { kind: 'portMode', port: p, mode: { kind: 'routed' } });
    },
  },
];
