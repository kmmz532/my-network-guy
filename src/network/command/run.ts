// 入力の行を実行する。木（COMMANDS）で解釈できる行は、その命令の run を呼ぶ。解釈できない行は、知らない命令の誤りにする。
import type { Tr } from '../terminal';
import { err, shown } from './lines';
import { INITIAL_SESSION } from './modes';
import { parseLine } from './parse';
import type { CommandContext, CommandResult, TerminalContext, TerminalSession } from './types';

export interface ViewRules {
  unlocked: (topic: string) => boolean;
  hideValues: boolean;
}

// 予測と候補の既定の見え方（論点はすべて解放し、値を隠さない）
const OPEN_VIEW: ViewRules = { unlocked: () => true, hideValues: false };

// 画面・試験が持つ文脈に、命令の木が要る項目を足す。view は予測と候補の見え方（省略は、論点をすべて解放して値を隠さない）
// session は機器ごとのターミナルの場面。省略は exec の初めの状態
export const commandContextOf = (base: TerminalContext, readOnly: boolean, session: TerminalSession = INITIAL_SESSION, view: ViewRules = OPEN_VIEW): CommandContext => ({
  ...base,
  session,
  unlocked: view.unlocked,
  hideValues: view.hideValues,
  readOnly,
});

// 入力欄の行は、画面では「> 」を付けて写す。誤りの位置の ^ は、その分を空ける
const ECHO_PREFIX = 2;

export const runLine = (line: string, ctx: CommandContext, tr: Tr): CommandResult => {
  const parsed = parseLine(line, ctx.session);
  if (parsed === null) return shown([]);
  if (!('error' in parsed)) return parsed.spec.run(parsed.args, ctx, tr);
  if (parsed.error === 'incomplete') return shown([err(tr('ui.terminal.incomplete'))]);
  if (parsed.error === 'ambiguous') return shown([err(tr('ui.terminal.ambiguous'))]);
  return shown([err(`${' '.repeat(ECHO_PREFIX + parsed.at)}^`), err(tr('ui.terminal.invalidAt'))]);
};

// 履歴と教材の記録に残す形。解釈できる行は、略記を展開した正式な形にし、できない行は打った行のままにする
export const canonicalLine = (line: string, session: TerminalSession): string => {
  const parsed = parseLine(line, session);
  return parsed !== null && 'spec' in parsed ? parsed.line : line.trim();
};
