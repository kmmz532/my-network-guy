// NAT の論点の命令。
import type { TerminalLine } from '../../terminal';
import { changed, err, out, portMissing, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { interfaceOf } from '../../command/modes';
import { ifaceIdOf } from '../../command/args';
import { getComponent } from '../../components';
import { networkOf } from '../../ip';

const PORT = { arg: 'number', name: 'port' } as const;

// 口ごとの NAT の向き（ip nat inside・ip nat outside）。口の番号は行に書く形（exec・config）。interface モードの形は口の番号を外す
const natIface = (nat: 'inside' | 'outside'): CommandSpec => ({
  id: `nat.ipNat${nat === 'inside' ? 'Inside' : 'Outside'}`,
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'nat' }, { word: nat }, PORT],
  help: `ui.cmd.nat.ipNat${nat === 'inside' ? 'Inside' : 'Outside'}`,
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
  help: 'ui.cmd.nat.ipNatNapt',
  writes: true,
  topic: 'nat',
  run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'nat', change: { op: 'napt', on: true } }),
};

const ipNatStatic: CommandSpec = {
  id: 'nat.ipNatStatic',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'nat' }, { word: 'static' }, PORT, { arg: 'ip', name: 'insideIp' }, { arg: 'number', name: 'insidePort' }],
  help: 'ui.cmd.nat.ipNatStatic',
  writes: true,
  topic: 'nat',
  run: (args, ctx, tr) => changed(ctx, tr, { kind: 'nat', change: { op: 'static', port: Number(args.port), insideIp: args.insideIp, insidePort: Number(args.insidePort) } }),
};

export const commands: readonly CommandSpec[] = [
  {
    id: 'nat.showIpNatTranslations',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'nat' }, { word: 'translations' }],
    help: 'ui.cmd.nat.showIpNatTranslations',
    writes: false,
    topic: 'nat',
    run: (_args, { node }, tr) => {
      // 設定から決まる変換（静的 NAT の転送と、NAPT の変換先）を出す。通信ごとの変換は保存しないため出さない（N146）
      const outside = node.interfaces.find((i) => i.nat === 'outside');
      const nat = getComponent(node, 'nat');
      const statics = nat?.statics ?? [];
      if (!nat?.napt && statics.length === 0) return shown([out(tr('ui.terminal.natNone'))]);
      if (!outside) return shown([err(tr('ui.terminal.natNoOutside'))]);
      const inside = node.interfaces.find((i) => i.nat === 'inside');
      if (nat?.napt && !inside) return shown([err(tr('ui.terminal.natNoInside'))]);
      // 見出しの欄（Pro・Inside global・Inside local・Outside local・Outside global）に合わせ、各欄を幅にそろえて詰める。
      // 外の欄は通信ごとの変換を保存しないため、NAPT・静的 NAT とも `---`
      const row = (key: 'ui.terminal.natStatic' | 'ui.terminal.natNapt', c: { proto: string; inGlobal: string; inLocal: string }) =>
        out(
          tr(key, {
            proto: c.proto.padEnd(3),
            inGlobal: c.inGlobal.padEnd(21),
            inLocal: c.inLocal.padEnd(21),
            outLocal: '---'.padEnd(13),
            outGlobal: '---',
          }),
        );
      const lines: TerminalLine[] = statics.map((s) =>
        row('ui.terminal.natStatic', { proto: 'tcp', inGlobal: `${outside.ip}:${s.port}`, inLocal: `${s.insideIp}:${s.insidePort}` }),
      );
      if (nat?.napt && inside) {
        lines.push(row('ui.terminal.natNapt', { proto: '---', inGlobal: outside.ip, inLocal: `${networkOf(inside.ip, inside.prefix)}/${inside.prefix}` }));
      }
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
    help: 'ui.cmd.nat.noIpNatNapt',
    writes: true,
    topic: 'nat',
    run: (_args, ctx, tr) => changed(ctx, tr, { kind: 'nat', change: { op: 'napt', on: false } }),
  },
  {
    id: 'nat.noIpNatStatic',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'nat' }, { word: 'static' }, PORT],
    help: 'ui.cmd.nat.noIpNatStatic',
    writes: true,
    topic: 'nat',
    run: (args, ctx, tr) => changed(ctx, tr, { kind: 'nat', change: { op: 'noStatic', port: Number(args.port) } }),
  },
  {
    id: 'nat.noIpNat',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'nat' }, PORT],
    help: 'ui.cmd.nat.noIpNat',
    writes: true,
    topic: 'nat',
    run: (args, ctx, tr) => {
      const id = ifaceIdOf(ctx.node, Number(args.port));
      if (id === null) return portMissing(ctx, tr);
      return changed(ctx, tr, { kind: 'nat', change: { op: 'iface', id, nat: null } });
    },
  },
];
