// NAT の論点の命令。
import type { TerminalLine } from '../../terminal';
import { changed, err, out, portMissing, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';
import { interfaceForm } from '../../command/modes';
import { ifaceIdOf, isIp, port } from '../../command/args';

const ipNat: CommandSpec = {
  id: 'nat.ipNat',
  modes: ['exec', 'config'],
  tokens: [{ word: 'ip' }, { word: 'nat' }, { rest: 'args' }],
  help: '',
  writes: true,
  topic: 'nat',
  run: (args, ctx, tr) => {
    const words = args.args.split(' ').filter((w) => w !== '');
    const [kind, a, b, c] = words;
    if ((kind === 'inside' || kind === 'outside') && port(a ?? '') !== null && words.length === 2) {
      const id = ifaceIdOf(ctx.node, Number(a));
      if (id === null) return portMissing(ctx, tr);
      return changed(ctx, tr, { kind: 'nat', change: { op: 'iface', id, nat: kind } });
    }
    if (kind === 'napt' && words.length === 1) return changed(ctx, tr, { kind: 'nat', change: { op: 'napt', on: true } });
    if (kind === 'static' && words.length === 4 && port(a ?? '') !== null && isIp(b ?? '') && port(c ?? '') !== null) {
      return changed(ctx, tr, { kind: 'nat', change: { op: 'static', port: Number(a), insideIp: b, insidePort: Number(c) } });
    }
    return shown([err(tr('ui.terminal.usageNat'))]);
  },
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
  ipNat,
  interfaceForm(ipNat, (words, p) => [words[0], String(p), ...words.slice(1)]),
  {
    id: 'nat.noIpNat',
    modes: ['exec', 'config'],
    tokens: [{ word: 'no' }, { word: 'ip' }, { word: 'nat' }, { rest: 'args' }],
    help: '',
    writes: true,
    topic: 'nat',
    run: (args, ctx, tr) => {
      const words = args.args.split(' ').filter((w) => w !== '');
      if (words[0] === 'napt' && words.length === 1) return changed(ctx, tr, { kind: 'nat', change: { op: 'napt', on: false } });
      if (words[0] === 'static' && words.length === 2 && port(words[1]) !== null) return changed(ctx, tr, { kind: 'nat', change: { op: 'noStatic', port: Number(words[1]) } });
      if (words.length === 1 && port(words[0]) !== null) {
        const id = ifaceIdOf(ctx.node, Number(words[0]));
        if (id === null) return portMissing(ctx, tr);
        return changed(ctx, tr, { kind: 'nat', change: { op: 'iface', id, nat: null } });
      }
      return shown([err(tr('ui.terminal.usageNat'))]);
    },
  },
];
