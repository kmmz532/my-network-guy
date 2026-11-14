// NAT の論点の命令。
import type { TerminalLine } from '../../terminal';
import { err, out, shown } from '../../command/lines';
import type { CommandSpec } from '../../command/types';

export const commands: readonly CommandSpec[] = [
  {
    id: 'nat.showIpNatTranslations',
    modes: ['exec'],
    tokens: [{ word: 'show' }, { word: 'ip' }, { word: 'nat' }, { word: 'translations' }],
    help: '',
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
];
