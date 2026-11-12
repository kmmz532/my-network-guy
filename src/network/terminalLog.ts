// 端末の記録（出力と打った命令の履歴）の上限。古いものから捨てる。
import type { TerminalLine } from './terminal';

export const LOG_LINES = 500;
export const HISTORY_COMMANDS = 100;

// 出力の記録に行を足す（上限を超えたら古い行から捨てる）
export const appendLog = (log: readonly TerminalLine[], lines: readonly TerminalLine[]): TerminalLine[] => [...log, ...lines].slice(-LOG_LINES);

// 打った命令を履歴に足す（直前と同じ命令は重ねない。上限を超えたら古いものから捨てる）
export const pushCommand = (commands: readonly string[], line: string): string[] => {
  const next = commands[commands.length - 1] === line ? [...commands] : [...commands, line];
  return next.slice(-HISTORY_COMMANDS);
};
