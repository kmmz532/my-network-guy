// NAT の論点の命令。
import type { TerminalLine } from '../../terminal';
import { changed, err, out, portMissing, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { interfaceOf } from '../../command/modes';
import { ifaceIdOf } from '../../command/args';

const PORT = { arg: 'number', name: 'port' } as const;

// 口ごとの NAT の向き（ip nat inside・ip nat outside）。口の番号は行に書く形（exec・config）。interface モードの形は口の番号を外す
const natIface = (nat: 'inside' | 'outside'): CommandSpec => ({
  id: `nat.ipNat${nat === 'inside' ? 'Inside' : 'Outside'}`,
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'nat' }, { word: nat }, PORT],
  help: '',
  writes: true,
  topic: 'nat',
  run: (args, ctx, tr) => {
    const id = ifaceIdOf(ctx.node, Number(args.port));
    if (id === null) return portMissing(ctx, tr);
    return changed(ctx, tr, { kind: 'nat', change: { op: 'iface', id, nat } });
  },
});
const natInside = natIface('inside');
const natOutside = natIface('outside');

const ipNatNapt: CommandSpec = {
  id: 'nat.ipNatNapt',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'nat' }, { word: 'napt' }],
  help: '',
  writes: true,
  topic: 'nat',
  run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'nat', change: { op: 'napt', on: true } }),
};

const ipNatStatic: CommandSpec = {
  id: 'nat.ipNatStatic',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'nat' }, { word: 'static' }, PORT, { arg: 'ip', name: 'insideIp' }, { arg: 'number', name: 'insidePort' }],
  help: '',
  writes: true,
  topic: 'nat',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'nat', change: { op: 'static', port: Number(args.port), insideIp: args.insideIp, insidePort: Number(args.insidePort) } }),
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'nat.showIpNatTranslations',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'nat' }, { word: 'translations' }],
    help: '',
    writes: false,
    topic: 'nat',
    run: (_args, { node }, tr) => {
      // 設定から決まる変換（静的 NAT の転送と、NAPT の変換先）を出す。通信ごとの変換は保存しないため出さない（N146）
      const outside = node.interfaces.find((i) => i.nat === 'outside');
      const statics = node.statics ?? [];
      if (!node.napt && statics.length === 0) return shown([out(tr('ui.terminal.natNone'))]);
      if (!outside) return shown([err(tr('ui.terminal.natNoOutside'))]);
      const lines: TerminalLine[] = statics.map((s) =>
        out(tr('ui.terminal.natStatic', { outsideIp: outside.ip, outsidePort: s.port, insideIp: s.insideIp, insidePort: s.insidePort })),
      );
      if (node.napt) lines.push(out(tr('ui.terminal.natNapt', { outsideIp: outside.ip })));
      // 4 つの欄（内部グローバル・内部ローカル・外部ローカル・外部グローバル）の見出しを先頭に出す
      return shown([out(tr('ui.terminal.natHeader')), ...lines]);
    },
  },
  natInside,
  interfaceOf(natInside),
  natOutside,
  interfaceOf(natOutside),
  ipNatNapt,
  ipNatStatic,
  {
    id: 'nat.noIpNatNapt',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'nat' }, { word: 'napt' }],
    help: '',
    writes: true,
    topic: 'nat',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'nat', change: { op: 'napt', on: false } }),
  },
  {
    id: 'nat.noIpNatStatic',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'nat' }, { word: 'static' }, PORT],
    help: '',
    writes: true,
    topic: 'nat',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'nat', change: { op: 'noStatic', port: Number(args.port) } }),
  },
  {
    id: 'nat.noIpNat',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'nat' }, PORT],
    help: '',
    writes: true,
    topic: 'nat',
    run: (args, ctx, tr) => {
      const id = ifaceIdOf(ctx.node, Number(args.port));
      if (id === null) return portMissing(ctx, tr);
      return changed(ctx, tr, { kind: 'nat', change: { op: 'iface', id, nat: null } });
    },
  },
];
