// 入力の行を実行する。木（COMMANDS）で解釈できる行は、その命令の run を呼ぶ。解釈できない行は、知らない命令の誤りにする。
import type { Tr } from '../terminal';
import { err, shown } from './lines';
import { INITIAL_SESSION } from './modes';
import { parseLine } from './parse';
import type { CommandContext, CommandResult, TerminalContext, TerminalSession } from './types';

// 画面・試験が持つ文脈に、命令の木が要る項目を足す。モードは常に exec とし、論点はすべて解放して値を隠さない
// session は機器ごとのターミナルの場面。省略は exec の初めの状態
export const commandContextOf = (base: TerminalContext, readOnly: boolean, session: TerminalSession = INITIAL_SESSION): CommandContext => ({
  ...base,
  session,
  unlocked: () => true,
  hideValues: false,
  readOnly,
});

export const runLine = (line: string, ctx: CommandContext, tr: Tr): CommandResult => {
  const parsed = parseLine(line, ctx.session);
  if (parsed !== null) {
    if (!('error' in parsed)) return parsed.spec.run(parsed.args, ctx, tr);
    if (parsed.error === 'ambiguous') return shown([err(tr('ui.terminal.ambiguous'))]);
    throw new Error(`未対応の解釈の誤り: ${parsed.error}`);
  }
  const [cmd] = line.trim().split(/\s+/);
  if (cmd === '') return shown([]);
  // show で始まる行は、行全体を示す（略記は show に展開して読む）
  return shown([err(tr('ui.terminal.unknown', { cmd: 'show'.startsWith(cmd) ? line.trim() : cmd }))]);
};
