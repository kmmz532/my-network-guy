// 命令の run が出力の行と結果を作るための小さな部品。
import type { ConfigChange } from '../../company/operation';
import type { Tr, TerminalLine } from '../terminal';
import type { NetNode } from '../types';
import type { CommandContext, CommandResult, TerminalContext } from './types';

export const out = (text: string): TerminalLine => ({ text, kind: 'out' });
export const err = (text: string): TerminalLine => ({ text, kind: 'err' });

// 確認の命令の結果。設定の操作もモードの変更も伴わない
export const shown = (lines: readonly TerminalLine[]): CommandResult => ({ lines, change: null, session: null });

// 機器の画面に出す名前
export const nameOf = (ctx: TerminalContext, node: NetNode): string => (ctx.nameOf ? ctx.nameOf(node) : node.uid);

// 読み取り専用の機器に設定の命令を当てたときの誤り
export const readOnlyLine = (tr: Tr): TerminalLine => err(tr('ui.terminal.readOnly'));

// 設定を変える命令の結果。読み取り専用の機器では設定を変えず、読み取り専用の誤りを返す（構文の検査は呼ぶ側で済ませておく）
export const changed = (ctx: CommandContext, tr: Tr, change: ConfigChange): CommandResult =>
  ctx.readOnly ? shown([readOnlyLine(tr)]) : { lines: [], change, session: null };


// 指定された番号の口が機器にないときの結果。読み取り専用の機器では、中身の検査より先に読み取り専用の誤りを返す
export const portMissing = (ctx: CommandContext, tr: Tr): CommandResult => shown([ctx.readOnly ? readOnlyLine(tr) : err(tr('ui.terminal.noPort'))]);
