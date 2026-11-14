// 命令の run が出力の行と結果を作るための小さな部品。
import type { TerminalLine } from '../terminal';
import type { NetNode } from '../types';
import type { CommandResult, TerminalContext } from './types';

export const out = (text: string): TerminalLine => ({ text, kind: 'out' });
export const err = (text: string): TerminalLine => ({ text, kind: 'err' });

// 確認の命令の結果。設定の操作もモードの変更も伴わない
export const shown = (lines: readonly TerminalLine[]): CommandResult => ({ lines, change: null, session: null });

// 機器の画面に出す名前
export const nameOf = (ctx: TerminalContext, node: NetNode): string => (ctx.nameOf ? ctx.nameOf(node) : node.uid);
